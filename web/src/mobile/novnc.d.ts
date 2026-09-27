declare module "@novnc/novnc" {
  export default class RFB {
    constructor(target: HTMLElement, channel: WebSocket, options?: Record<string, unknown>);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    qualityLevel: number;
    addEventListener(type: string, listener: () => void): void;
    disconnect(): void;
  }
}
