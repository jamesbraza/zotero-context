/**
 * Plain-HTML list boxes and toggles for the toolkit's dialog window, where
 * native controls render badly: <select> popups draw over other fields,
 * <select size> collapses to one row, HTML radios hide their checked state,
 * and XUL radiogroups/menulists don't render at all.
 */

export interface ListItem {
  value: string;
  label: string;
}

/** Element props for a scrollable list of clickable rows. */
export function listBoxProps(
  id: string,
  items: ListItem[],
  onPick: (value: string) => void,
  rowClass?: string,
) {
  return {
    tag: "div",
    namespace: "html",
    id,
    classList: rowClass ? [`${rowClass}-row`] : [],
    styles: {
      width: "28em",
      maxHeight: "9em",
      overflowY: "auto",
      border: "1px solid GrayText",
      borderRadius: "4px",
      background: "Field",
    },
    children: items.map((item) => ({
      tag: "div",
      namespace: "html",
      attributes: { "data-value": item.value },
      properties: { textContent: item.label },
      styles: { padding: "0.2em 0.5em", cursor: "pointer" },
      listeners: [
        {
          type: "click",
          listener: () => {
            onPick(item.value);
          },
        },
      ],
    })),
  };
}

/** Highlight the chosen row and scroll only the list box to keep it visible. */
export function paintListBox(
  doc: Document | null,
  id: string,
  chosen: string,
): void {
  const rows = doc?.querySelectorAll(`#${id} > div`) as unknown as
    ArrayLike<HTMLElement> | undefined;
  for (const row of Array.from(rows ?? [])) {
    const on = row.dataset["value"] === chosen;
    row.style.background = on ? "SelectedItem" : "";
    row.style.color = on ? "SelectedItemText" : "";
    const box = row.parentElement as HTMLElement | null;
    if (on && box) {
      const top = row.offsetTop - box.offsetTop;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = top + row.offsetHeight - box.clientHeight;
      }
    }
  }
}

/** Element props for a hand-drawn checkbox (☐/☑ + label). */
export function toggleProps(
  id: string,
  label: string,
  onToggle: (checked: boolean) => void,
) {
  let checked = false;
  return {
    tag: "div",
    namespace: "html",
    id,
    attributes: { role: "checkbox", "aria-checked": "false", tabindex: "0" },
    properties: { textContent: `☐ ${label}` },
    styles: { cursor: "pointer", userSelect: "none" },
    listeners: [
      {
        type: "click",
        listener: (e: Event) => {
          checked = !checked;
          const el = e.currentTarget as HTMLElement | null;
          if (el) {
            el.textContent = `${checked ? "☑" : "☐"} ${label}`;
            el.setAttribute("aria-checked", String(checked));
          }
          onToggle(checked);
        },
      },
    ],
  };
}
