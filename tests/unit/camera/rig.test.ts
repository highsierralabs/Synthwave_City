import { describe, expect, it } from 'vitest';
import { CAMERA_RADIUS, MAX_ALTITUDE } from '../../../src/camera/flight';
import { BLEND_TIME, EASE_TIME, IDLE_OFFER, REDUCED_RATE, createCameraRig, type CameraRig } from '../../../src/camera/index';
import { Tour, createTourSample } from '../../../src/camera/tour';
import { createCityPlan } from '../../../src/city/index';
import type { CameraPose } from '../../../src/contracts/camera';
import { CAMERA_FOV, CELL, TILE } from '../../../src/contracts/constants';
import { angleDelta, wrapDelta } from '../../../src/core/math';
import { createRng } from '../../../src/core/random';
import { blocked, boxPlan, corridorMargin, emptyPlan, finitePose, makeFrame, makePose, tick } from './helpers';

const plan = createCityPlan(1984);
const DT = 1 / 60;

function distance(a: CameraPose, b: CameraPose): number {
  return Math.hypot(wrapDelta(a.x, b.x, TILE), a.y - b.y, wrapDelta(a.z, b.z, TILE));
}

/** Run a rig live for some seconds; returns the largest per-frame move (m/s) and turn (rad/s) seen. */
function run(rig: CameraRig, frame: ReturnType<typeof makeFrame>, pose: CameraPose, seconds: number, dt = DT): { speed: number; turn: number } {
  let speed = 0, turn = 0;
  const last = { ...pose };
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    tick(frame, dt);
    rig.update(frame, pose);
    speed = Math.max(speed, distance(pose, last) / dt);
    turn = Math.max(turn, Math.abs(angleDelta(last.yaw, pose.yaw)) / dt);
    Object.assign(last, pose);
  }
  return { speed, turn };
}

function start(options: Parameters<typeof createCameraRig>[1] = {}): { rig: CameraRig; frame: ReturnType<typeof makeFrame>; pose: CameraPose; actions: string[] } {
  const actions: string[] = [];
  const rig = createCameraRig(plan, { onAction: (a) => actions.push(a), ...options });
  const frame = makeFrame(0, 0);
  const pose = makePose();
  rig.update(frame, pose);
  return { rig, frame, pose, actions };
}

describe('rig: the tour', () => {
  it('starts on the tour and follows it', () => {
    const { rig, frame, pose } = start();
    expect(rig.mode).toBe('tour');
    run(rig, frame, pose, 10);
    const tour = new Tour(plan, plan.seed);
    const s = createTourSample();
    tour.sample(frame.time, s);
    expect(distance(pose, { ...pose, x: s.x, y: s.y, z: s.z })).toBeLessThan(1e-6);
    expect(pose.yaw).toBeCloseTo(s.yaw, 9);
    expect(pose.fov).toBe(CAMERA_FOV);
    expect(rig.speed).toBeCloseTo(s.speed, 6);
  });

  it('with the clock frozen, the pose is a function of frame.time alone', () => {
    const a = start(), b = start();
    run(b.rig, b.frame, b.pose, 3);
    for (const t of [20, 21.5, 23, 500, 23]) {
      a.frame.time = t;
      a.frame.dt = 0;
      a.rig.update(a.frame, a.pose);
      b.frame.time = t;
      b.frame.dt = 0;
      b.rig.update(b.frame, b.pose);
      b.rig.update(b.frame, b.pose);
      expect(b.pose).toEqual(a.pose);
    }
    // Scrubbing 1.5 s moves the camera roughly as far as it flies in 1.5 s.
    a.frame.time = 20;
    a.rig.update(a.frame, a.pose);
    const at20 = { ...a.pose };
    a.frame.time = 21.5;
    a.rig.update(a.frame, a.pose);
    expect(distance(a.pose, at20)).toBeGreaterThan(20);
    expect(distance(a.pose, at20)).toBeLessThan(95);
  });

  it('does not move on a frame with dt 0 and an unchanged clock (a resync, a paused app)', () => {
    const { rig, frame, pose } = start();
    run(rig, frame, pose, 2);
    rig.setReducedMotion(true);
    run(rig, frame, pose, 5);
    // Tour time and frame.time have now drifted apart; a zero step must not snap them together.
    const before = { ...pose };
    frame.dt = 0;
    rig.update(frame, pose);
    rig.update(frame, pose);
    expect(pose).toEqual(before);
  });

  it('reduced motion slows the tour and removes the bank', () => {
    const normal = start(), reduced = start({ reducedMotion: true });
    let roll = 0, rollReduced = 0, travelled = 0, travelledReduced = 0;
    const last = { ...normal.pose }, lastReduced = { ...reduced.pose };
    for (let i = 0; i < 60 * 120; i++) {
      tick(normal.frame, DT);
      normal.rig.update(normal.frame, normal.pose);
      tick(reduced.frame, DT);
      reduced.rig.update(reduced.frame, reduced.pose);
      roll = Math.max(roll, Math.abs(normal.pose.roll));
      rollReduced = Math.max(rollReduced, Math.abs(reduced.pose.roll));
      travelled += distance(normal.pose, last);
      travelledReduced += distance(reduced.pose, lastReduced);
      Object.assign(last, normal.pose);
      Object.assign(lastReduced, reduced.pose);
    }
    expect(roll).toBeGreaterThan(0.1);
    expect(rollReduced).toBe(0);
    expect(reduced.rig.reducedMotion).toBe(true);
    expect(travelledReduced / travelled).toBeGreaterThan(REDUCED_RATE * 0.8);
    expect(travelledReduced / travelled).toBeLessThan(REDUCED_RATE * 1.25);
  });
});

describe('rig: handing over', () => {
  it('any movement input takes over from the tour without a jump, keeping the velocity', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 24.5);
    const before = { ...pose };
    const tourSpeed = rig.speed;
    rig.input.keyDown({ code: 'KeyD' });
    tick(frame, DT);
    rig.update(frame, pose);
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode']);
    // One frame of travel at the speed it had, and the same view direction.
    expect(distance(pose, before)).toBeLessThan(tourSpeed * DT * 1.1);
    expect(distance(pose, before)).toBeGreaterThan(tourSpeed * DT * 0.8);
    expect(Math.abs(angleDelta(before.yaw, pose.yaw))).toBeLessThan(1e-9);
    expect(pose.pitch).toBeCloseTo(before.pitch, 9);
    expect(Math.abs(pose.roll - before.roll)).toBeLessThan(0.02);
    expect(Math.abs(rig.speed - tourSpeed)).toBeLessThan(3);
  });

  it('a look takes over too, and the camera then coasts to a stop', () => {
    const { rig, frame, pose } = start();
    run(rig, frame, pose, 5);
    const before = { ...pose };
    rig.input.pointerMove({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, movementX: 40, movementY: 0 }, true);
    tick(frame, DT);
    rig.update(frame, pose);
    expect(rig.mode).toBe('free');
    expect(angleDelta(before.yaw, pose.yaw)).toBeCloseTo(-40 * 0.0022, 6);
    const moved = run(rig, frame, pose, 4);
    expect(moved.speed).toBeLessThan(45);
    expect(rig.speed).toBeLessThan(0.01);
  });

  it('setMode switches both ways, reports once, and ignores the mode it is already in', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 1);
    rig.setMode('tour');
    expect(actions).toEqual([]);
    rig.setMode('free');
    rig.setMode('free');
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode']);
    run(rig, frame, pose, 1);
    rig.setMode('tour');
    expect(rig.mode).toBe('tour');
    expect(actions).toEqual(['mode', 'mode']);
  });

  it('Space toggles, digits choose viewpoints, and app keys pass straight through', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 1);
    rig.handleKey(rig.input.keyDown({ code: 'Space' })!);
    expect(rig.mode).toBe('free');
    rig.handleKey(rig.input.keyDown({ code: 'Space' })!);
    expect(rig.mode).toBe('tour');
    for (const code of ['Escape', 'KeyM', 'KeyH', 'KeyT', 'KeyP']) rig.handleKey(rig.input.keyDown({ code })!);
    rig.handleKey(rig.input.keyDown({ code: 'Digit3' })!);
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode', 'mode', 'menu', 'mute', 'stats', 'mood', 'photo', 'mode', 'viewpoint:2']);
  });

  it('returns to the tour smoothly from where free flight left the camera', () => {
    const { rig, frame, pose } = start();
    run(rig, frame, pose, 8);
    // Fly off up and to the side, looking round, then let go.
    rig.input.keyDown({ code: 'KeyW' });
    rig.input.keyDown({ code: 'KeyE' });
    rig.input.keyDown({ code: 'ArrowLeft' });
    run(rig, frame, pose, 3);
    rig.input.reset();
    run(rig, frame, pose, 0.5);
    const speedBefore = rig.speed;
    expect(speedBefore).toBeGreaterThan(5);
    const before = { ...pose };
    rig.setMode('tour');
    tick(frame, DT);
    rig.update(frame, pose);
    // No jump at the switch: it keeps moving as it was.
    expect(distance(pose, before)).toBeLessThan(speedBefore * DT * 1.5 + 0.05);
    expect(Math.abs(angleDelta(before.yaw, pose.yaw))).toBeLessThan(0.01);
    // Nor anywhere on the way back.
    const moved = run(rig, frame, pose, 20);
    expect(moved.speed).toBeLessThan(110);
    expect(moved.turn).toBeLessThan(1.7);
    expect(rig.mode).toBe('tour');
    expect(corridorMargin(pose.x, pose.z)).toBeGreaterThan(3.4);
    // And it is now simply on a tour again: it keeps going without touching anything.
    for (let i = 0; i < 60 * 60; i++) {
      tick(frame, DT);
      rig.update(frame, pose);
      expect(blocked(plan, pose.x, pose.y, pose.z, CAMERA_RADIUS)).toBe(false);
    }
  });

  it('rejoins from anywhere free flight can reach, without ever entering a box', () => {
    const rng = createRng(11);
    const { rig, frame, pose } = start();
    for (let trial = 0; trial < 40; trial++) {
      // Wander: random keys, random look, sometimes low among the buildings.
      rig.setMode('free');
      for (const code of ['KeyW', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft']) {
        if (rng.chance(0.4)) rig.input.keyDown({ code });
      }
      rig.input.keyDown({ code: rng.chance(0.5) ? 'ArrowLeft' : 'ArrowRight' });
      run(rig, frame, pose, rng.range(0.5, 6));
      rig.input.reset();
      if (rng.chance(0.5)) run(rig, frame, pose, 2);
      // It may be going very fast when asked (boost at altitude); it must not go faster after.
      const limit = Math.max(rig.speed, 130) * 1.1;
      rig.setMode('tour');
      let last = { ...pose };
      let joined = false;
      for (let i = 0; i < 60 * 40; i++) {
        tick(frame, DT);
        rig.update(frame, pose);
        expect(finitePose(pose)).toBe(true);
        expect(blocked(plan, pose.x, pose.y, pose.z, CAMERA_RADIUS * 0.95), `trial ${trial} frame ${i}`).toBe(false);
        expect(distance(pose, last) / DT).toBeLessThan(limit);
        expect(Math.abs(angleDelta(last.yaw, pose.yaw)) / DT).toBeLessThan(1.8);
        last = { ...pose };
        // Twelve seconds in it has had time to join: from then on it must be in a road corridor.
        if (i > 60 * 30) joined = corridorMargin(pose.x, pose.z) > 3.4;
      }
      expect(joined, `trial ${trial}`).toBe(true);
    }
  });

  it('boxed in on every side, it climbs out over the roofs before crossing to a road', () => {
    // A walled courtyard in the middle of cell (10, 10): walls 100 m high, no gap.
    const walls = [
      { x0: 1630, x1: 1730, y1: 100, z0: 1630, z1: 1640 },
      { x0: 1630, x1: 1730, y1: 100, z0: 1720, z1: 1730 },
      { x0: 1630, x1: 1640, y1: 100, z0: 1630, z1: 1730 },
      { x0: 1720, x1: 1730, y1: 100, z0: 1630, z1: 1730 },
    ];
    const yard = boxPlan(walls);
    const rig = createCameraRig(yard, { mode: 'free' });
    const frame = makeFrame(0, 0);
    const pose = makePose();
    Object.assign(pose, { x: 1690, y: 20, z: 1675, yaw: 1, pitch: 0 });
    rig.update(frame, pose);
    rig.setMode('tour');
    let top = 0, crossedLow = false;
    let last = { ...pose };
    for (let i = 0; i < 60 * 40; i++) {
      tick(frame, DT);
      rig.update(frame, pose);
      expect(blocked(yard, pose.x, pose.y, pose.z, CAMERA_RADIUS * 0.95), `frame ${i}`).toBe(false);
      expect(distance(pose, last) / DT).toBeLessThan(120);
      last = { ...pose };
      top = Math.max(top, pose.y);
      // Over a wall while still below its top would mean it went through.
      if (yard.heightAt(pose.x, pose.z) > 0 && pose.y < 100) crossedLow = true;
    }
    expect(crossedLow).toBe(false);
    expect(top).toBeGreaterThan(100 + CAMERA_RADIUS);
    expect(rig.mode).toBe('tour');
    expect(corridorMargin(pose.x, pose.z)).toBeGreaterThan(3.4);
  });

  it('with one way out of the yard, it takes it without climbing', () => {
    // The same yard with its -z wall missing.
    const walls = [
      { x0: 1630, x1: 1730, y1: 100, z0: 1720, z1: 1730 },
      { x0: 1630, x1: 1640, y1: 100, z0: 1630, z1: 1730 },
      { x0: 1720, x1: 1730, y1: 100, z0: 1630, z1: 1730 },
    ];
    const yard = boxPlan(walls);
    const rig = createCameraRig(yard, { mode: 'free' });
    const frame = makeFrame(0, 0);
    const pose = makePose();
    // Nearer the +z wall than the open side, so the nearest road is not the reachable one.
    Object.assign(pose, { x: 1680, y: 20, z: 1700, yaw: 1, pitch: 0 });
    rig.update(frame, pose);
    rig.setMode('tour');
    let top = 0;
    for (let i = 0; i < 60 * 12; i++) {
      tick(frame, DT);
      rig.update(frame, pose);
      expect(blocked(yard, pose.x, pose.y, pose.z, CAMERA_RADIUS * 0.95), `frame ${i}`).toBe(false);
      if (i < 60 * 4) top = Math.max(top, pose.y);
    }
    expect(top).toBeLessThan(40);
    expect(corridorMargin(pose.x, pose.z)).toBeGreaterThan(3.4);
  });

  it('input during the return hands control straight back', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 2);
    rig.setMode('free');
    run(rig, frame, pose, 1);
    rig.setMode('tour');
    run(rig, frame, pose, 0.3);
    const before = { ...pose };
    rig.input.keyDown({ code: 'KeyW' });
    tick(frame, DT);
    rig.update(frame, pose);
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode', 'mode', 'mode']);
    expect(distance(pose, before)).toBeLessThan(2);
    expect(Math.abs(angleDelta(before.yaw, pose.yaw))).toBeLessThan(0.05);
  });

  it('offers to resume after thirty idle seconds in free flight, and withdraws the offer on input', () => {
    const { rig, frame, pose } = start();
    rig.setMode('free');
    run(rig, frame, pose, IDLE_OFFER - 1);
    expect(rig.resumeSuggested).toBe(false);
    run(rig, frame, pose, 1.5);
    expect(rig.resumeSuggested).toBe(true);
    expect(rig.mode).toBe('free');
    rig.input.keyDown({ code: 'KeyW' });
    run(rig, frame, pose, 0.1);
    expect(rig.resumeSuggested).toBe(false);
    rig.input.reset();
    rig.setMode('tour');
    expect(rig.resumeSuggested).toBe(false);
  });

  it('starting in free mode takes the pose the engine already has', () => {
    const rig = createCameraRig(plan, { mode: 'free' });
    const frame = makeFrame(5, 0);
    const pose = makePose();
    const view = rig.viewpoints[3]!.pose;
    Object.assign(pose, view, { x: view.x + TILE });
    rig.update(frame, pose);
    expect(rig.mode).toBe('free');
    expect(pose.x).toBeCloseTo(view.x, 9);
    expect(pose.y).toBe(view.y);
    expect(pose.yaw).toBe(view.yaw);
    run(rig, frame, pose, 1);
    expect(distance(pose, view)).toBeLessThan(1e-6);
  });
});

describe('rig: viewpoints', () => {
  it('glides to a viewpoint in a second and stays there in free flight', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 3);
    rig.goToViewpoint(4);
    expect(rig.mode).toBe('free');
    expect(actions).toEqual(['mode', 'viewpoint:4']);
    const target = rig.viewpoints[4]!.pose;
    const begin = { ...pose };
    const far = distance(begin, target);
    // Half way through it is on its way, not there.
    run(rig, frame, pose, EASE_TIME / 2);
    expect(distance(pose, target)).toBeGreaterThan(far * 0.2);
    expect(distance(pose, target)).toBeLessThan(far * 0.8);
    const moved = run(rig, frame, pose, EASE_TIME / 2 + 0.1);
    expect(moved.turn).toBeLessThan(12);
    expect(distance(pose, target)).toBeLessThan(1e-6);
    expect(Math.abs(angleDelta(pose.yaw, target.yaw))).toBeLessThan(1e-9);
    expect(pose.pitch).toBeCloseTo(target.pitch, 9);
    expect(pose.roll).toBeCloseTo(0, 6);
    run(rig, frame, pose, 2);
    expect(distance(pose, target)).toBeLessThan(1e-6);
    expect(rig.speed).toBeLessThan(1e-6);
  });

  it('starts the glide where the camera is: no jump on the first frame', () => {
    const { rig, frame, pose } = start();
    run(rig, frame, pose, 3);
    const before = { ...pose };
    rig.goToViewpoint(0);
    tick(frame, DT);
    rig.update(frame, pose);
    const far = distance(before, rig.viewpoints[0]!.pose);
    expect(distance(pose, before)).toBeLessThan(far * 0.001);
  });

  it('every viewpoint can be reached, and the tour can be rejoined from each', () => {
    const { rig, frame, pose } = start();
    for (let i = 0; i < 6; i++) {
      rig.goToViewpoint(i);
      run(rig, frame, pose, EASE_TIME + 0.1);
      expect(distance(pose, rig.viewpoints[i]!.pose)).toBeLessThan(1e-6);
      rig.setMode('tour');
      for (let k = 0; k < 60 * 30; k++) {
        tick(frame, DT);
        rig.update(frame, pose);
        expect(blocked(plan, pose.x, pose.y, pose.z, CAMERA_RADIUS * 0.95), `viewpoint ${i} frame ${k}`).toBe(false);
      }
      expect(rig.mode).toBe('tour');
      expect(corridorMargin(pose.x, pose.z)).toBeGreaterThan(3.4);
    }
  });

  it('ignores indices that are not viewpoints', () => {
    const { rig, frame, pose, actions } = start();
    run(rig, frame, pose, 1);
    for (const i of [-1, 6, 2.5, Number.NaN]) rig.goToViewpoint(i);
    expect(rig.mode).toBe('tour');
    expect(actions).toEqual([]);
  });

  it('cuts instead of gliding under reduced motion, and lands at once when the clock is frozen', () => {
    const reduced = start({ reducedMotion: true });
    run(reduced.rig, reduced.frame, reduced.pose, 1);
    reduced.rig.goToViewpoint(1);
    tick(reduced.frame, DT);
    reduced.rig.update(reduced.frame, reduced.pose);
    expect(distance(reduced.pose, reduced.rig.viewpoints[1]!.pose)).toBeLessThan(1e-6);

    const frozen = start();
    frozen.rig.goToViewpoint(2);
    frozen.frame.dt = 0;
    frozen.rig.update(frozen.frame, frozen.pose);
    expect(distance(frozen.pose, frozen.rig.viewpoints[2]!.pose)).toBeLessThan(1e-6);
  });
});

describe('rig: robustness', () => {
  it('ten minutes of random input never produces a NaN, a box, or a position out of bounds', () => {
    const rng = createRng(2024);
    const { rig, frame, pose } = start();
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft'];
    const steps = [1 / 144, 1 / 60, 1 / 60, 1 / 30, 0.1, 0];
    let elapsed = 0, gliding = 0, quiet = 0, touring = 0, flying = 0;
    while (elapsed < 600) {
      // Now and then let go of everything and ask for the tour, so the way back is exercised too.
      let r = rng.next();
      if (quiet > 0) r = 1;
      else if (r > 0.995) {
        rig.input.reset();
        rig.setMode('tour');
        quiet = rng.range(0.2, 14);
      }
      if (r < 0.08) rig.input.keyDown({ code: rng.pick(keys) });
      else if (r < 0.16) rig.input.keyUp({ code: rng.pick(keys) });
      else if (r < 0.26) rig.input.pointerMove({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, movementX: rng.range(-400, 400), movementY: rng.range(-400, 400) }, true);
      else if (r < 0.262) rig.setMode('tour');
      else if (r < 0.264) rig.setMode('free');
      else if (r < 0.266) {
        rig.goToViewpoint(rng.int(0, 5));
        gliding = EASE_TIME + 0.2;
      } else if (r < 0.268) rig.setReducedMotion(rng.chance(0.5));
      else if (r < 0.272) rig.input.reset();
      else if (r < 0.28) rig.input.gamepad(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.next(), rng.next(), rng.chance(0.3));
      else if (r < 0.285) {
        rig.input.pointerDown({ pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 100 });
        rig.input.pointerMove({ pointerId: 3, pointerType: 'touch', clientX: rng.range(0, 800), clientY: rng.range(0, 800) }, false);
      } else if (r < 0.29) rig.input.pointerUp({ pointerId: 3, pointerType: 'touch', clientX: 0, clientY: 0 });
      const dt = rng.pick(steps);
      tick(frame, dt);
      if (frame.time > 4096) frame.time -= 4096;
      rig.update(frame, pose);
      elapsed += dt;
      gliding -= dt;
      quiet -= dt;
      if (rig.mode === 'tour') touring += dt;
      else flying += dt;
      expect(finitePose(pose)).toBe(true);
      expect(pose.x).toBeGreaterThanOrEqual(0);
      expect(pose.x).toBeLessThan(TILE);
      expect(pose.z).toBeGreaterThanOrEqual(0);
      expect(pose.z).toBeLessThan(TILE);
      expect(pose.y).toBeGreaterThanOrEqual(CAMERA_RADIUS - 1e-9);
      expect(pose.y).toBeLessThanOrEqual(MAX_ALTITUDE);
      expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(pose.roll)).toBeLessThan(0.3);
      expect(pose.fov).toBeGreaterThanOrEqual(CAMERA_FOV);
      expect(pose.fov).toBeLessThanOrEqual(CAMERA_FOV + 7);
      // A glide to a viewpoint is the one move allowed to cross buildings.
      if (gliding <= 0) expect(blocked(plan, pose.x, pose.y, pose.z, CAMERA_RADIUS * 0.95), `at ${elapsed.toFixed(2)} s`).toBe(false);
    }
    expect(touring).toBeGreaterThan(60);
    expect(flying).toBeGreaterThan(60);
  });

  it('works on a plan with nothing in it', () => {
    const rig = createCameraRig(emptyPlan(), {});
    const frame = makeFrame(0, 0);
    const pose = makePose();
    rig.update(frame, pose);
    run(rig, frame, pose, 30);
    rig.setMode('free');
    rig.input.keyDown({ code: 'KeyW' });
    run(rig, frame, pose, 3);
    rig.input.reset();
    rig.goToViewpoint(5);
    run(rig, frame, pose, 2);
    rig.setMode('tour');
    run(rig, frame, pose, 20);
    expect(finitePose(pose)).toBe(true);
    expect(rig.mode).toBe('tour');
    expect(rig.viewpoints).toHaveLength(6);
  });

  it('free flight crosses the edge of the tile without a jump in direction or speed', () => {
    const rig = createCameraRig(plan, { mode: 'free' });
    const frame = makeFrame(0, 0);
    const pose = makePose();
    // On an avenue (x = 0 is one), a few metres short of the tile edge in z, flying towards -z.
    Object.assign(pose, { x: 0, y: 700, z: 6, yaw: 0, pitch: 0 });
    rig.update(frame, pose);
    rig.input.keyDown({ code: 'KeyW' });
    let wrapped = false, lastSpeed = 0;
    const last = { ...pose };
    for (let i = 0; i < 120; i++) {
      tick(frame, DT);
      rig.update(frame, pose);
      if (pose.z > last.z) wrapped = true;
      const step = wrapDelta(pose.z, last.z, TILE);
      expect(step).toBeLessThanOrEqual(0);
      expect(step).toBeGreaterThan(-4);
      expect(Math.abs(rig.speed - lastSpeed)).toBeLessThan(8);
      expect(pose.yaw).toBe(0);
      lastSpeed = rig.speed;
      Object.assign(last, pose);
    }
    expect(wrapped).toBe(true);
    expect(pose.z).toBeGreaterThan(TILE - 400);
    expect(Math.abs(pose.x)).toBeLessThan(1e-6);
    expect(CELL).toBe(160);
  });

  it('the blend back onto the tour lasts BLEND_TIME and ends exactly on it', () => {
    const { rig, frame, pose } = start();
    run(rig, frame, pose, 4);
    rig.setMode('free');
    run(rig, frame, pose, 3);
    rig.setMode('tour');
    run(rig, frame, pose, 12 + BLEND_TIME);
    // Once on the tour, the pose moves at tour speeds and banks only in turns.
    const moved = run(rig, frame, pose, 5);
    expect(moved.speed).toBeLessThan(63);
    expect(moved.speed).toBeGreaterThan(12);
  });
});
