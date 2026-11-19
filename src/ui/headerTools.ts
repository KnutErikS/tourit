import { $ } from '../util';

/**
 * Phones: the place search and the warning-date row fold away behind two icon
 * buttons in the panel header, so the bottom sheet keeps more room for content.
 * At most one is open at a time. On PC the buttons are hidden by CSS and both
 * rows are always shown, so none of this has any visible effect there.
 */

export type HeaderTool = 'search' | 'date';

const TOOLS: Record<HeaderTool, { button: string; cls: string }> = {
  search: { button: 'tool-search', cls: 'show-search' },
  date: { button: 'tool-date', cls: 'show-date' },
};

let open: HeaderTool | null = null;

export function setHeaderTool(tool: HeaderTool | null): void {
  open = tool;
  const panel = $('panel');
  for (const [name, t] of Object.entries(TOOLS) as [HeaderTool, (typeof TOOLS)[HeaderTool]][]) {
    panel.classList.toggle(t.cls, name === tool);
    $(t.button).setAttribute('aria-expanded', String(name === tool));
  }
}

export function initHeaderTools(): void {
  for (const name of Object.keys(TOOLS) as HeaderTool[]) {
    $(TOOLS[name].button).addEventListener('click', () => {
      setHeaderTool(open === name ? null : name);
      if (open === 'search') $<HTMLInputElement>('search').focus();
    });
  }
}
