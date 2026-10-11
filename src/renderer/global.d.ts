import type { DesktopAPI } from '../product/contracts';
declare global { interface Window { workbench: DesktopAPI } }
export {};
