import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComposerToolButton } from "../../src/pages/patient/tools/ComposerToolButton";

/**
 * Milestone 7.5, Priority 5. At 320x568 and at 200% zoom (720x450) the open
 * tool menu was 390px tall and its bottom edge sat 100-160px below the viewport.
 *
 * Why a transform on the absolutely positioned menu was not enough: the menu
 * lives inside the dashboard's scrolling container (1010px of content in a 474px
 * scrollport on a 568px phone), and the composer trigger itself is far below the
 * fold. Opening the menu moves focus to its first item, which scrolls that
 * container, and the menu travels with the scroll. So the menu is positioned
 * against the viewport instead (`position: fixed`), clamped 16px inside it, and
 * its height is capped so a very short viewport scrolls inside the menu rather
 * than clipping it.
 *
 * jsdom has no layout, so these tests report rectangles and a viewport and check
 * the placement the component computes. The real geometry is verified in the
 * browser at the six established viewports.
 */
interface Mock { menuHeight: number; menuWidth?: number; trigger: { top: number; bottom: number; left: number } }

function mockLayout(m: Mock, viewport: { w: number; h: number }) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport.w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport.h });
  const rect = (top: number, left: number, w: number, h: number) =>
    ({ top, bottom: top + h, height: h, left, right: left + w, width: w, x: left, y: top, toJSON() {} }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "menu") {
      const cap = this.style.maxHeight.endsWith("px") ? parseFloat(this.style.maxHeight) : Infinity;
      const h = Math.min(m.menuHeight, cap);
      const w = m.menuWidth ?? 288;
      // Not yet placed by the component: wherever the stylesheet would have put it.
      if (this.style.position !== "fixed") return rect(m.trigger.top - 8 - h, m.trigger.left, w, h);
      return rect(parseFloat(this.style.top || "0"), parseFloat(this.style.left || "0"), w, h);
    }
    if (this.classList.contains("composer-tool-trigger")) return rect(m.trigger.top, m.trigger.left, 30, m.trigger.bottom - m.trigger.top);
    return rect(0, 0, 0, 0);
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.getAttribute?.("role") === "menu" ? (m.menuWidth ?? 288) : 0; } });
}

async function openMenu() {
  const user = userEvent.setup();
  render(<ComposerToolButton onSelect={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add a health record" }));
  return { user, menu: screen.getByRole("menu") as HTMLElement };
}
const bounds = (m: HTMLElement) => m.getBoundingClientRect();
const inside = (m: HTMLElement, vw: number, vh: number) => {
  const r = bounds(m);
  expect(r.top).toBeGreaterThanOrEqual(16);
  expect(r.bottom).toBeLessThanOrEqual(vh - 16);
  expect(r.left).toBeGreaterThanOrEqual(16);
  expect(r.right).toBeLessThanOrEqual(vw - 16);
};

describe("tool menu stays inside the viewport", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("is positioned against the viewport, so scrolling the dashboard cannot move it out", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 935, bottom: 965, left: 100 } }, { w: 320, h: 568 });
    const { menu } = await openMenu();
    expect(menu.style.position).toBe("fixed");
  });

  it("320x568 with the trigger far below the fold: the whole menu is inside", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 935, bottom: 965, left: 100 } }, { w: 320, h: 568 });
    const { menu } = await openMenu();
    inside(menu, 320, 568);
  });

  it("200% zoom (720x450) with the trigger below the fold: the whole menu is inside", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 700, bottom: 730, left: 116 } }, { w: 720, h: 450 });
    const { menu } = await openMenu();
    inside(menu, 720, 450);
  });

  it("opens above the trigger when there is room for it", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 800, bottom: 830, left: 60 } }, { w: 1440, h: 900 });
    const { menu } = await openMenu();
    expect(bounds(menu).bottom).toBe(800 - 8);
    inside(menu, 1440, 900);
  });

  it("opens below the trigger when there is no room above", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 100, bottom: 130, left: 60 } }, { w: 1440, h: 900 });
    const { menu } = await openMenu();
    expect(bounds(menu).top).toBe(130 + 8);
    inside(menu, 1440, 900);
  });

  it("a viewport shorter than the menu caps its height and scrolls inside instead of clipping", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 200, bottom: 230, left: 40 } }, { w: 320, h: 260 });
    const { menu } = await openMenu();
    expect(menu.style.maxHeight).toBe("228px");           // 260 - 2 * 16
    expect(menu.style.overflowY).toBe("auto");
    inside(menu, 320, 260);
  });

  it("never runs past the right edge", async () => {
    mockLayout({ menuHeight: 390, trigger: { top: 500, bottom: 530, left: 250 } }, { w: 320, h: 568 });
    const { menu } = await openMenu();
    inside(menu, 320, 568);
  });
});

describe("keyboard behaviour is unchanged", () => {
  beforeEach(() => mockLayout({ menuHeight: 390, trigger: { top: 935, bottom: 965, left: 100 } }, { w: 320, h: 568 }));
  afterEach(() => vi.restoreAllMocks());

  it("keeps menu semantics, arrow navigation, Escape dismissal and focus restoration", async () => {
    const user = userEvent.setup();
    render(<ComposerToolButton onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Add a health record" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Add a health record" });
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(items[items.length - 1]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
