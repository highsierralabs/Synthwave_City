import { describe, expect, it } from 'vitest';
import { CAMERA_RADIUS } from '../../../src/camera/flight';
import { computeViewpoints, yawTowards } from '../../../src/camera/viewpoints';
import { createCityPlan } from '../../../src/city/index';
import { CAMERA_FOV, TILE } from '../../../src/contracts/constants';
import { angleDelta, wrapDelta } from '../../../src/core/math';
import { blocked, corridorMargin, emptyPlan, finitePose } from './helpers';

const plan = createCityPlan(1984);
const views = computeViewpoints(plan);

describe('viewpoints', () => {
  it('are six, named, finite and inside the tile', () => {
    expect(views).toHaveLength(6);
    expect(new Set(views.map((v) => v.name)).size).toBe(6);
    for (const v of views) {
      expect(v.name.length).toBeGreaterThan(0);
      expect(finitePose(v.pose)).toBe(true);
      expect(v.pose.x).toBeGreaterThanOrEqual(0);
      expect(v.pose.x).toBeLessThan(TILE);
      expect(v.pose.z).toBeGreaterThanOrEqual(0);
      expect(v.pose.z).toBeLessThan(TILE);
      expect(v.pose.roll).toBe(0);
      expect(v.pose.fov).toBe(CAMERA_FOV);
      expect(Math.abs(v.pose.pitch)).toBeLessThan(1);
    }
  });

  it('lie outside every box, with the camera sphere clear, for several cities', () => {
    for (const seed of [1984, 7, 3, 2025]) {
      const p = seed === 1984 ? plan : createCityPlan(seed);
      for (const v of computeViewpoints(p)) {
        expect(blocked(p, v.pose.x, v.pose.y, v.pose.z, CAMERA_RADIUS), `${v.name} in city ${seed}`).toBe(false);
        expect(v.pose.y).toBeGreaterThanOrEqual(CAMERA_RADIUS);
      }
    }
  });

  it('stand where they were meant to: five over a road, one on a roof, none nudged out of a wall', () => {
    for (const seed of [1984, 7, 3, 2025]) {
      const p = seed === 1984 ? plan : createCityPlan(seed);
      const v = computeViewpoints(p);
      for (const i of [0, 1, 3, 4, 5]) {
        expect(corridorMargin(v[i]!.pose.x, v[i]!.pose.z), `${v[i]!.name} in city ${seed}`).toBeGreaterThan(8);
      }
      const roof = v[2]!.pose;
      expect(p.heightAt(roof.x, roof.z), `rooftop in city ${seed}`).toBeGreaterThan(60);
      expect(roof.y - p.heightAt(roof.x, roof.z)).toBeCloseTo(2.4, 6);
    }
  });

  it('are deterministic', () => {
    expect(computeViewpoints(createCityPlan(1984))).toEqual(views);
  });

  it('1: street level on an avenue, facing the sun', () => {
    const p = views[0]!.pose;
    expect(p.y).toBeLessThan(4);
    expect(corridorMargin(p.x, p.z)).toBeGreaterThan(15);
    expect(p.yaw).toBe(0);
  });

  it('2: mid-height in the downtown canyon', () => {
    const p = views[1]!.pose;
    const downtown = plan.landmarks.find((l) => l.kind === 'downtown')!;
    expect(p.y).toBeGreaterThan(60);
    expect(p.y).toBeLessThan(downtown.height);
    expect(corridorMargin(p.x, p.z)).toBeGreaterThan(15);
    expect(Math.hypot(wrapDelta(p.x, downtown.x, TILE), wrapDelta(p.z, downtown.z, TILE))).toBeLessThan(700);
  });

  it('3: standing on a roof, just above it and near its edge', () => {
    const p = views[2]!.pose;
    const roof = plan.heightAt(p.x, p.z);
    expect(roof).toBeGreaterThan(100);
    expect(p.y - roof).toBeGreaterThan(CAMERA_RADIUS);
    expect(p.y - roof).toBeLessThan(4);
    // The roof ends within a few metres on the sun's side.
    expect(plan.heightAt(p.x, p.z - 6)).toBeLessThan(roof);
  });

  it('4: a high panorama above every roof nearby', () => {
    const p = views[3]!.pose;
    expect(p.y).toBeGreaterThan(700);
    expect(p.pitch).toBeLessThan(-0.1);
  });

  it('5: beside the tallest megatower, with it in view', () => {
    const p = views[4]!.pose;
    const mega = plan.landmarks.find((l) => l.kind === 'megatower')!;
    const dist = Math.hypot(wrapDelta(p.x, mega.x, TILE), wrapDelta(p.z, mega.z, TILE));
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(400);
    expect(p.y).toBeLessThan(mega.height);
    expect(Math.abs(angleDelta(p.yaw, yawTowards(p.x, p.z, mega.x, mega.z)))).toBeLessThan(0.45);
  });

  it('6: over a plaza, looking down at its middle', () => {
    const p = views[5]!.pose;
    const plazas = plan.landmarks.filter((l) => l.kind === 'plaza');
    const dist = Math.min(...plazas.map((l) => Math.hypot(wrapDelta(p.x, l.x, TILE), wrapDelta(p.z, l.z, TILE))));
    expect(dist).toBeLessThan(130);
    expect(p.pitch).toBeLessThan(-0.3);
    expect(p.y).toBeGreaterThan(30);
  });

  it('still gives six clear poses for a plan with no landmarks', () => {
    const bare = emptyPlan();
    const fallback = computeViewpoints(bare);
    expect(fallback).toHaveLength(6);
    for (const v of fallback) {
      expect(finitePose(v.pose)).toBe(true);
      expect(blocked(bare, v.pose.x, v.pose.y, v.pose.z, CAMERA_RADIUS)).toBe(false);
    }
  });
});
