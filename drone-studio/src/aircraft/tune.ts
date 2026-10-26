import { common, MavLinkProtocolV2 } from 'node-mavlink';
import { GROUND_COMPONENT_ID, GROUND_SYSTEM_ID } from './read-requests';
import { tuneToMml, type Tune } from '../platform/music-model';
export function tuneFrame(system: number, component: number, sequence: number, tune: Tune) {
  const mml = tuneToMml(tune);
  const message = new common.PlayTune();
  message.targetSystem = system;
  message.targetComponent = component;
  message.tune = mml.slice(0, 30);
  message.tune2 = mml.slice(30);
  return new MavLinkProtocolV2(GROUND_SYSTEM_ID, GROUND_COMPONENT_ID).serialize(message, sequence % 256);
}
