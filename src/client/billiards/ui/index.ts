/**
 * The UI substrate the aim schemes are built on: an orientation rule for
 * things that live in the world, a HUD layer for things that live on the
 * screen, panels that work as either readouts or controls, and one shared
 * notion of who is currently dragging.
 */
export {
  DragScopeProvider,
  DragSurface,
  useDragHandle,
  useDragScope,
  type DragScope,
} from './drag';
export { FacingGroup } from './facing';
export { HudLayer, HudPanel } from './hud';
export { Panel, useOwnedTexture } from './panel';
export { createPanelCanvas, finishPanelTexture, makeReadoutPanelTexture } from './panels';
export { PANEL_INK_DIM, PANEL_SIZE, panelBar, panelDial, panelFrame, panelText } from './paint';
