import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConfigContext, ConfigProvider } from "@univerjs/design";
import { Ribbon } from "@univerjs/ui";
import { HostedOverlays } from "./sheet-overlays";

type SheetRibbonProps = {
  targetId: string;
};

type ClonedStyle = {
  node: HTMLStyleElement | HTMLLinkElement;
  signature: string;
};

export function clearStaleSheetRibbonNodes(root: Pick<ShadowRoot, "querySelectorAll">) {
  root.querySelectorAll(
    "[data-sheet-ribbon-style], [data-sheet-ribbon-layout], [data-sheet-ribbon-mount]",
  ).forEach(node => node.remove());
}

/**
 * Renders Univer's live ribbon in a host-document element while keeping its
 * styles scoped to that element's shadow root.
 */
export function SheetRibbon({ targetId }: SheetRibbonProps) {
  const { locale, direction } = useContext(ConfigContext);
  const [mountContainer, setMountContainer] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    const hostDocument = window.parent.document;
    const iframeDocument = document;
    let host: HTMLElement | null = null;
    let shadowRoot: ShadowRoot | null = null;
    let mount: HTMLDivElement | null = null;
    let layoutStyle: HTMLStyleElement | null = null;
    const clonedStyles = new Map<Element, ClonedStyle>();

    const clearHost = () => {
      for (const { node } of clonedStyles.values()) node.remove();
      clonedStyles.clear();
      layoutStyle?.remove();
      layoutStyle = null;
      mount?.remove();
      mount = null;
      host = null;
      shadowRoot = null;
      setMountContainer(null);
    };

    const syncStyles = () => {
      if (!shadowRoot || !mount) return;

      const sources = Array.from(
        iframeDocument.head.querySelectorAll<
          HTMLStyleElement | HTMLLinkElement
        >('style, link[rel="stylesheet"]'),
      );
      const currentSources = new Set<Element>(sources);

      for (const [source, cloned] of clonedStyles) {
        if (!currentSources.has(source)) {
          cloned.node.remove();
          clonedStyles.delete(source);
        }
      }

      for (const source of sources) {
        const isLink = source.tagName === "LINK";
        const signature = `${source.outerHTML}${isLink ? (source as HTMLLinkElement).href : ""}`;
        let cloned = clonedStyles.get(source);

        if (!cloned || cloned.signature !== signature) {
          const node = hostDocument.importNode(source, true) as
            | HTMLStyleElement
            | HTMLLinkElement;
          if (node.tagName === "LINK")
            (node as HTMLLinkElement).href = (source as HTMLLinkElement).href;
          node.setAttribute("data-sheet-ribbon-style", "true");
          cloned?.node.remove();
          cloned = { node, signature };
          clonedStyles.set(source, cloned);
        }

        // Keep the iframe head's cascade order, with every owned style before
        // the ribbon mount point. Inserting an existing node also reorders it.
        shadowRoot.insertBefore(cloned.node, mount);
      }
      if (layoutStyle) shadowRoot.insertBefore(layoutStyle, mount);
      // Theme variables on the iframe's :root do not cross a shadow boundary.
      const theme=iframeDocument.defaultView!.getComputedStyle(iframeDocument.documentElement);
      for (const property of theme) if (property.startsWith('--univer-')) mount.style.setProperty(property,theme.getPropertyValue(property));
    };

    const ensureHost = () => {
      if (!targetId || !hostDocument.body) return;
      const nextHost = hostDocument.getElementById(targetId);
      if (nextHost === host) return;

      clearHost();
      if (!nextHost) return;

      host = nextHost;
      shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      // A previous iframe generation may have been destroyed before its React
      // cleanup ran. Remove only nodes owned by this host before mounting anew.
      clearStaleSheetRibbonNodes(shadowRoot);
      mount = hostDocument.createElement("div");
      mount.dataset.sheetRibbonMount = "true";
      mount.style.boxSizing = "border-box";
      mount.style.width = "100%";
      mount.style.minWidth = "0";
      mount.style.overflow = "visible";
      layoutStyle = hostDocument.createElement("style");
      layoutStyle.dataset.sheetRibbonLayout = "true";
      layoutStyle.textContent = `
        :host { display: block; min-width: 0; }
        [data-sheet-ribbon-mount] { min-width: 0; overflow: visible; }
        [data-u-comp="rect-popup"] {
          box-sizing: border-box; max-width: calc(100vw - 16px);
          max-height: min(65vh, 520px); overflow-x: hidden !important;
          overflow-y: auto !important; overscroll-behavior: contain;
          scrollbar-width: thin;
        }
        [data-sheet-ribbon-mount] [data-u-comp="ribbon-header-menu"] {
          width: 100%; min-width: 0; height: auto !important;
        }
        [data-sheet-ribbon-mount] [data-u-comp="ribbon-grid-menu"] {
          height: auto !important; max-height: min(55vh, 460px) !important;
          overflow-x: hidden !important; overflow-y: auto !important;
          scrollbar-width: thin;
          flex-direction: row; flex-wrap: wrap; align-items: stretch; padding: 4px 0;
        }
        [data-sheet-ribbon-mount] [data-u-comp="ribbon-grid-menu"] > button {
          width: auto; flex: 1 1 auto; height: auto !important; min-height: 28px;
          justify-content: flex-start; white-space: normal !important; text-align: left;
        }
        [data-sheet-ribbon-mount] [data-u-comp="ribbon-grid-toolbar"] {
          width: 100%; min-width: 0; flex-direction: column;
          align-items: stretch; overflow: visible !important; padding: 0;
        }
        [data-sheet-ribbon-mount] [data-u-comp="ribbon-grid-group"] {
          width: 100%; min-width: 0; flex: none !important; padding: 4px 0 !important;
        }
        [data-sheet-ribbon-mount] [data-testid="ribbon-grid-group-grid"] {
          min-height: 0; flex: none !important; grid-auto-flow: row !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          grid-template-rows: none !important;
        }
        [data-sheet-ribbon-mount] [data-testid="ribbon-grid-group-grid"] > div {
          min-width: 0; width: auto !important;
          grid-row: auto !important; grid-column: auto !important;
        }
        [data-sheet-ribbon-mount] [data-testid="ribbon-grid-group-grid"] > div[style*="width:"],
        [data-sheet-ribbon-mount] [data-testid="ribbon-grid-group-grid"] > div:has([data-u-command] span) {
          grid-column: 1 / -1 !important;
        }
        [data-sheet-ribbon-mount]:has([data-hosted-sheet-sidebar]) > [data-u-comp="ribbon-header-menu"],
        [data-sheet-ribbon-mount]:has([data-hosted-sheet-sidebar]) > [data-u-comp="ribbon-grid-toolbar"] {
          display: none;
        }
        [data-sheet-ribbon-mount] [data-testid="ribbon-grid-group-divider"] {
          top: auto !important; right: 8px !important; bottom: 0 !important; left: 8px !important;
          width: auto !important; height: 0 !important;
          border: 0 !important; border-bottom: 1px solid currentColor !important;
        }
      `;
      shadowRoot.append(layoutStyle);
      shadowRoot.append(mount);
      setMountContainer(mount);
      syncStyles();
    };

    const hostObserver = new MutationObserver(ensureHost);
    hostObserver.observe(hostDocument.body, { childList: true, subtree: true });
    const styleObserver = new MutationObserver(syncStyles);
    styleObserver.observe(iframeDocument.head, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    ensureHost();
    return () => {
      hostObserver.disconnect();
      styleObserver.disconnect();
      for (const { node } of clonedStyles.values()) node.remove();
      clonedStyles.clear();
      layoutStyle?.remove();
      mount?.remove();
    };
  }, [targetId]);

  if (!mountContainer) return null;

  return createPortal(
    <ConfigProvider
      locale={locale}
      direction={direction}
      mountContainer={mountContainer}
    >
      <Ribbon ribbonType="grid" headerMenu={false} />
      <HostedOverlays />
    </ConfigProvider>,
    mountContainer,
  );
}
