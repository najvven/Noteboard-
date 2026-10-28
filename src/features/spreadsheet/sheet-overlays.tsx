import React, { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import type { Injector } from "@univerjs/core";
import {
  DesktopSidebarService,
  DesktopDialogService,
  CustomLabel,
  IUIPartsService,
  ISidebarService,
  IDialogService,
  useDependency,
  useObservable,
  type ISidebarMethodOptions,
} from "@univerjs/ui";
import { Dialog, type IDialogProps } from "@univerjs/design";
import { BehaviorSubject, combineLatest, map, startWith, defer } from "rxjs";

// Each UI request keeps one canonical Univer service and one renderer. Only
// its presentation changes between the host panel and the expanded workbench.
const expanded = new BehaviorSubject(false);
export const setOverlayPresentation = (value: boolean) => expanded.next(value);

export class HostedSidebarService extends DesktopSidebarService {
  readonly hosted$ = combineLatest([
    defer(() => this.sidebarOptions$.pipe(startWith(this.options))),
    expanded,
  ]).pipe(
    map(([value, full]) => (full ? { ...value, visible: false } : value)),
  );
  readonly nativeOptions$ = combineLatest([
    defer(() => this.sidebarOptions$.pipe(startWith(this.options))),
    expanded,
  ]).pipe(map(([value, full]) => (full ? value : { visible: false })));
  private hostContainer?: HTMLElement;
  private frameContainer?: HTMLElement;
  // The native workbench gets a presentation facade. Commands/plugins retain
  // the canonical service and its unmodified visibility notifications.
  nativeFacade() {
    const owner = this;
    return {
      sidebarOptions$: this.nativeOptions$,
      scrollEvent$: this.scrollEvent$,
      get options() {
        return expanded.value ? owner.options : { visible: false };
      },
      get visible() {
        return expanded.value && owner.visible;
      },
      get width() {
        return owner.width;
      },
      setWidth: (width: number) => owner.setWidth(width),
      getContainer: () => owner.getContainer(),
      setContainer: (element?: HTMLElement) => owner.setContainer(element),
      open: (options: ISidebarMethodOptions) => owner.open(options),
      close: (id?: string) => owner.close(id),
    };
  }
  override setContainer(element?: HTMLElement) {
    if (!element) return;
    if (element.ownerDocument === document) this.frameContainer = element;
    else this.hostContainer = element;
  }
  override getContainer() {
    return expanded.value ? this.frameContainer : this.hostContainer;
  }
}

export class HostedDialogService extends DesktopDialogService {
  private readonly nativeDialogs$ = combineLatest([
    super.getDialogs$().pipe(startWith(this._dialogOptions)),
    expanded,
  ]).pipe(map(([options, full]) => (full ? options : [])));
  private readonly hostedDialogs$ = combineLatest([
    super.getDialogs$().pipe(startWith(this._dialogOptions)),
    expanded,
  ]).pipe(map(([options, full]) => (full ? [] : options)));
  constructor(injector: Injector, parts: IUIPartsService) {
    super(injector, parts);
  }
  override getDialogs$() {
    return this.nativeDialogs$;
  }
  getHostedDialogs$() {
    return this.hostedDialogs$;
  }
}

type LabelOptions = NonNullable<ISidebarMethodOptions["children"]>;
function EngineLabel({ options }: { options?: LabelOptions }) {
  return options ? <CustomLabel {...options} /> : null;
}

export function HostedOverlays() {
  const sidebar = useDependency(ISidebarService) as HostedSidebarService,
    dialogs = useDependency(IDialogService) as HostedDialogService;
  const options = useObservable(sidebar.hosted$, {}),
    list = useObservable(dialogs.getHostedDialogs$(), []);
  useEffect(() => {
    if (!options.visible) return;
    const owner = parent.document;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        sidebar.close(options.id);
      }
    };
    owner.addEventListener("keydown", close, true);
    return () => owner.removeEventListener("keydown", close, true);
  }, [sidebar, options.visible, options.id]);
  return (
    <>
      {options.visible && (
        <section
          data-hosted-sheet-sidebar
          role="complementary"
          aria-label="Spreadsheet details"
          className="univer-relative univer-flex univer-min-h-0 univer-flex-col univer-overflow-hidden univer-bg-white univer-text-gray-900"
          style={{ maxHeight: "calc(100vh - 8rem)" }}
        >
          <div className="univer-flex univer-items-center univer-justify-between univer-gap-2 univer-py-2 univer-font-semibold">
            <EngineLabel options={options.header} />
            <button
              aria-label="Back to spreadsheet tools"
              title="Back"
              onClick={() => sidebar.close(options.id)}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
          <div
            ref={(element) => {
              if (element) sidebar.setContainer(element);
            }}
            data-sheet-detail-scroll="true"
            className="univer-min-h-0 univer-overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 12rem)", overflowY: "auto" }}
            onScroll={(event) => sidebar.scrollEvent$.next(event.nativeEvent)}
          >
            <EngineLabel options={options.children} />
          </div>
          <EngineLabel options={options.footer} />
        </section>
      )}
      {list.map((options) => {
        const { children, title, footer, ...rest } = options;
        const props: IDialogProps = {
          ...rest,
          children: <EngineLabel options={children} />,
          title: <EngineLabel options={title} />,
          footer: <EngineLabel options={footer} />,
        };
        return (
          <React.Fragment key={options.id}>
            <Dialog {...props} />
          </React.Fragment>
        );
      })}
    </>
  );
}
