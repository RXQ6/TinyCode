import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DesktopAPI } from '../product/contracts';
import type { AgentEvent } from '../core/contracts';
const api: DesktopAPI = {
  info: () => ipcRenderer.invoke('app:info'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  demo: () => ipcRenderer.invoke('workspace:demo'),
  start: request => ipcRenderer.invoke('agent:start', request),
  cancel: id => ipcRenderer.invoke('agent:cancel', id),
  history: () => ipcRenderer.invoke('agent:history'),
  events: id => ipcRenderer.invoke('agent:events', id),
  resume: (id, input) => ipcRenderer.invoke('agent:resume', id, input),
  onEvent: listener => {
    const handler = (_event: IpcRendererEvent, event: AgentEvent): void => listener(event);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  }
};
contextBridge.exposeInMainWorld('workbench', api);
