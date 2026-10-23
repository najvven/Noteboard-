import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostedSidebarService,
  setOverlayPresentation,
} from "../src/features/spreadsheet/sheet-overlays";
test("docking a sidebar changes only its renderer and preserves canonical plugin visibility", () => {
  const previousFrame = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const service = new HostedSidebarService(),
    canonical: boolean[] = [],
    native: boolean[] = [],
    hosted: boolean[] = [];
  const subscriptions = [
    service.sidebarOptions$.subscribe((options) =>
      canonical.push(Boolean(options.visible)),
    ),
    service.nativeOptions$.subscribe((options) =>
      native.push(Boolean(options.visible)),
    ),
    service.hosted$.subscribe((options) =>
      hosted.push(Boolean(options.visible)),
    ),
  ];
  try {
    setOverlayPresentation(false);
    service.open({ id: "validation" });
    assert.deepEqual(canonical, [true]);
    assert.equal(hosted.at(-1), true);
    assert.equal(native.at(-1), false);
    assert.equal(service.visible, true);
    assert.equal(service.nativeFacade().visible, false);
    setOverlayPresentation(true);
    assert.deepEqual(canonical, [true]);
    assert.equal(hosted.at(-1), false);
    assert.equal(native.at(-1), true);
    assert.equal(service.nativeFacade().visible, true);
    service.close("other");
    assert.deepEqual(canonical, [true]);
    service.close("validation");
    assert.deepEqual(canonical, [true, false]);
  } finally {
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    service.dispose();
    setOverlayPresentation(false);
    globalThis.requestAnimationFrame = previousFrame;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});
