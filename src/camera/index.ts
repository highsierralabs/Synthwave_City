// The camera (architecture.md section 7, plan T11): a cinematic tour of the road grid, free flight
// with collision, six viewpoints, and the input that moves between them. No three, no src/city:
// the plan arrives as a CityPlan and the pose leaves as a CameraPose.
export {
  createCameraRig, BLEND_TIME, EASE_TIME, IDLE_OFFER, REDUCED_RATE, TURN_RATE,
  type CameraMode, type CameraRig, type CameraRigOptions,
} from './rig';
export { computeViewpoints, type Viewpoint } from './viewpoints';
export { InputMapper, isCameraKey, type InputState, type KeyAction, type KeyLike, type PointerLike } from './input';
export { Tour, createTourSample, type TourSample, type TourStart } from './tour';
export { CAMERA_RADIUS, MAX_ALTITUDE, stepFlight, topSpeed, type FlightState } from './flight';
