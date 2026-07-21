import type { ReactNode } from "react";

function DiagramFigure({ children, caption }: { children: ReactNode; caption: ReactNode }) {
  return (
    <figure data-scale-figure>
      <div data-scale-panel>{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function WindowVsCopyDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 1</strong> Same store, two philosophies. Copying scales with the data; a window scales with the screen.</>}
    >
      <svg viewBox="0 0 720 320" role="img" aria-label="Copying the entire store freezes the dashboard, while a sliding window sends only the visible slice and stays fluid.">
        <defs>
          <marker id="window-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-deleted-fill /></marker>
          <marker id="window-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
        </defs>

        <text x="48" y="30" data-svg-eyebrow data-svg-deleted-fill>THE TRAP · COPY EVERYTHING</text>
        <rect x="48" y="44" width="96" height="78" rx="8" data-svg-stroke />
        {[66, 80, 94, 108].map((y) => <line key={y} x1="60" y1={y} x2="132" y2={y} data-svg-stroke data-svg-thin />)}
        <text x="48" y="140" data-svg-faint>on-device store · GB</text>
        <line x1="156" y1="83" x2="470" y2="83" data-svg-deleted markerEnd="url(#window-warn)" />
        <text x="312" y="74" textAnchor="middle" data-svg-deleted-text>serialize all of it</text>
        <rect x="486" y="46" width="150" height="74" rx="8" data-svg-deleted-wash />
        <line x1="486" y1="64" x2="636" y2="64" data-svg-deleted data-svg-thin />
        <path d="M506,98 l10,-16 l10,20 l10,-22 l10,24 l10,-14 l10,10" data-svg-deleted />
        <text x="561" y="140" textAnchor="middle" data-svg-deleted-text>frozen · O(dataset)</text>

        <line x1="40" y1="164" x2="680" y2="164" data-svg-divider />

        <text x="48" y="196" data-svg-eyebrow data-svg-accent-fill>THE RULE · SLIDE A WINDOW</text>
        <rect x="48" y="210" width="96" height="78" rx="8" data-svg-stroke />
        {[232, 246, 260, 274].map((y) => <line key={y} x1="60" y1={y} x2="132" y2={y} data-svg-stroke data-svg-thin />)}
        <g data-sliding-window>
          <rect x="42" y="220" width="108" height="28" rx="4" data-svg-accent-wash />
          <path d="M152,228 l6,6 l-6,6" data-svg-accent />
        </g>
        <text x="48" y="303" data-svg-faint>window = visible slice only</text>
        <line x1="156" y1="249" x2="470" y2="249" data-svg-accent markerEnd="url(#window-accent)" />
        <text x="312" y="240" textAnchor="middle" data-svg-accent-text>just the slice</text>
        <rect x="486" y="212" width="150" height="74" rx="8" data-svg-surface data-svg-accent />
        <line x1="486" y1="230" x2="636" y2="230" data-svg-accent data-svg-thin />
        <path d="M502,266 q14,-22 28,-2 q14,20 28,-6 q14,-20 28,2" data-svg-accent />
        <text x="561" y="303" textAnchor="middle" data-svg-accent-text>60fps · O(visible)</text>
      </svg>
    </DiagramFigure>
  );
}

export function BytePathDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 2</strong> Two lanes. Previews ride ordinary messages; full values and exports use bounded streams.</>}
    >
      <svg viewBox="0 0 720 300" role="img" aria-label="The app runtime paginates and truncates data, a local bridge carries bounded frames, and the Studio renders a virtual viewport. Full values use a streaming lane.">
        <defs>
          <marker id="path-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
        </defs>

        <text x="34" y="26" data-svg-eyebrow data-svg-muted-fill>YOUR APP</text>
        <text x="312" y="26" data-svg-eyebrow data-svg-subtle-fill>LOCAL BRIDGE</text>
        <text x="560" y="26" data-svg-eyebrow data-svg-muted-fill>STUDIO</text>

        <rect x="34" y="40" width="196" height="150" rx="10" data-svg-surface data-svg-stroke />
        <DiagramRow x={50} y={58} label="getAllKeys — names" />
        <DiagramRow x={50} y={96} label="paged read · yields" />
        <DiagramRow x={50} y={134} label="truncate → preview" />
        <text x="130" y="182" textAnchor="middle" data-svg-faint>paged values · ≤8ms slices</text>

        <rect x="322" y="70" width="76" height="90" rx="8" data-svg-panel data-svg-stroke data-svg-dash />
        <text x="360" y="112" textAnchor="middle" data-svg-faint>WS</text>
        <text x="360" y="130" textAnchor="middle" data-svg-faint>≤256KB</text>

        <rect x="490" y="40" width="196" height="150" rx="10" data-svg-surface data-svg-stroke />
        <DiagramRow x={506} y={58} label="virtualized DOM" />
        <DiagramRow x={506} y={96} label="stale-request guards" />
        <DiagramRow x={506} y={134} label="bounded history" />
        <text x="588" y="182" textAnchor="middle" data-svg-faint>60fps · O(viewport)</text>

        <line x1="230" y1="86" x2="322" y2="86" data-svg-accent markerEnd="url(#path-accent)" />
        <line x1="398" y1="86" x2="490" y2="86" data-svg-accent markerEnd="url(#path-accent)" />
        <text x="360" y="52" textAnchor="middle" data-svg-accent-text>previews + metadata</text>
        <line x1="230" y1="144" x2="322" y2="144" data-svg-accent data-svg-dash markerEnd="url(#path-accent)" />
        <line x1="398" y1="144" x2="490" y2="144" data-svg-accent data-svg-dash markerEnd="url(#path-accent)" />

        <text x="360" y="238" textAnchor="middle" data-svg-accent-text>stream lane · full values &amp; export</text>
        <path d="M588 190 L588 214 L636 214" data-svg-accent data-svg-dash markerEnd="url(#path-accent)" />
        <rect x="642" y="200" width="46" height="34" rx="5" data-svg-surface data-svg-accent />
        <text x="665" y="222" textAnchor="middle" data-svg-accent-text>disk</text>
      </svg>
    </DiagramFigure>
  );
}

function DiagramRow({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width="164" height="30" rx="6" data-svg-panel data-svg-stroke />
      <text x={x + 12} y={y + 19} data-svg-soft>{label}</text>
    </g>
  );
}

export function StreamDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 3</strong> Bounded chunks, cancelable, checksum-verified. Supported browsers write directly to a file.</>}
    >
      <svg viewBox="0 0 720 260" role="img" aria-label="A large value is read in slices and transferred as bounded chunks. Supported browsers write directly to disk; others use a buffered download fallback.">
        <defs>
          <marker id="stream-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
          <marker id="stream-soft" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-subtle-fill /></marker>
        </defs>

        <text x="26" y="26" data-svg-eyebrow data-svg-muted-fill>DEVICE</text>
        <rect x="26" y="40" width="118" height="150" rx="10" data-svg-surface data-svg-stroke />
        <text x="85" y="60" textAnchor="middle" data-svg-faint>200 MB value</text>
        {[72, 88, 104, 120, 136].map((y) => <rect key={y} x="44" y={y} width="82" height="12" rx="2" data-svg-accent-wash />)}
        <text x="85" y="172" textAnchor="middle" data-svg-faint>read a slice</text>
        <text x="85" y="185" textAnchor="middle" data-svg-faint>at a time</text>

        <line x1="150" y1="112" x2="470" y2="112" data-svg-divider-strong />
        <StreamChunk x={156} width={40} label="begin" filled />
        <StreamChunk x={206} width={30} label="0" />
        <StreamChunk x={242} width={30} label="1" />
        <StreamChunk x={278} width={30} label="2" />
        <text x="326" y="117" textAnchor="middle" data-svg-faint>· · ·</text>
        <StreamChunk x={344} width={30} label="n" />
        <StreamChunk x={384} width={76} label="end ✓ sum" filled />
        <text x="308" y="88" textAnchor="middle" data-svg-faint>each chunk ≤ 64 KB · yield between reads</text>
        <path d="M470 140 L176 140" data-svg-subtle-line data-svg-dash markerEnd="url(#stream-soft)" />
        <text x="323" y="156" textAnchor="middle" data-svg-faint>cancel — stop the device mid-read</text>

        <text x="500" y="26" data-svg-eyebrow data-svg-muted-fill>STUDIO</text>
        <line x1="476" y1="112" x2="500" y2="112" data-svg-accent markerEnd="url(#stream-accent)" />
        <rect x="500" y="46" width="196" height="52" rx="9" data-svg-surface data-svg-stroke />
        <rect x="516" y="60" width="30" height="24" rx="4" data-svg-stroke />
        <path d="M521,76 q5,-10 10,-1 q5,8 10,-4" data-svg-accent />
        <text x="558" y="76" data-svg-soft>render if small</text>
        <rect x="500" y="130" width="196" height="56" rx="9" data-svg-surface data-svg-accent />
        <rect x="516" y="146" width="26" height="24" rx="4" data-svg-accent />
        <text x="554" y="154" data-svg-accent-text>save to disk</text>
        <text x="554" y="171" data-svg-faint>buffer fallback elsewhere</text>
      </svg>
    </DiagramFigure>
  );
}

function StreamChunk({ x, width, label, filled = false }: { x: number; width: number; label: string; filled?: boolean }) {
  return (
    <g>
      <rect x={x} y="98" width={width} height="28" rx="5" data-svg-surface={!filled || undefined} data-svg-accent-wash={filled || undefined} data-svg-accent={!filled || undefined} />
      <text x={x + width / 2} y="116" textAnchor="middle" data-svg-accent-text>{label}</text>
    </g>
  );
}

export function FluidityDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 4</strong> The same rule, twice: slices free the app thread; a viewport keeps the dashboard DOM small.</>}
    >
      <svg viewBox="0 0 720 250" role="img" aria-label="Short reads let application frames run between slices, while dashboard virtualization renders only the rows currently visible.">
        <text x="24" y="26" data-svg-eyebrow data-svg-muted-fill>THE APP · JS THREAD</text>
        <text x="24" y="66" data-svg-deleted-text>✕ one blocking read</text>
        <rect x="24" y="76" width="320" height="20" rx="4" data-svg-deleted-wash />
        {[70, 150, 230, 310].map((x) => <text key={x} x={x} y="60" data-svg-deleted-fill>✕</text>)}
        <text x="24" y="112" data-svg-faint>frames dropped · app janks</text>

        <text x="24" y="152" data-svg-accent-text>✓ short slices + yields</text>
        {[24, 86, 148, 210, 272].map((x) => <rect key={x} x={x} y="162" width="46" height="20" rx="4" data-svg-accent-wash />)}
        {[76, 138, 200, 262].map((x) => <text key={x} x={x} y="177" data-svg-accent-fill>▲</text>)}
        <text x="24" y="204" data-svg-faint>≤8ms each · your frames (▲) run in the gaps</text>

        <line x1="372" y1="36" x2="372" y2="214" data-svg-divider />
        <text x="398" y="26" data-svg-eyebrow data-svg-muted-fill>THE DASHBOARD · DOM</text>
        <rect x="398" y="44" width="150" height="170" rx="8" data-svg-stroke />
        <text x="408" y="64" data-svg-faint>1,000,000 rows</text>
        {[76, 88, 150, 162, 174, 200].map((y) => <line key={y} x1="410" y1={y} x2="536" y2={y} data-svg-divider />)}
        <rect x="404" y="100" width="138" height="44" rx="5" data-svg-accent-wash />
        {[112, 122, 132].map((y) => <line key={y} x1="414" y1={y} x2="532" y2={y} data-svg-accent data-svg-thin />)}
        <text x="566" y="126" data-svg-accent-text>≈ 30 nodes</text>
        <text x="566" y="144" data-svg-faint>actually rendered</text>
      </svg>
    </DiagramFigure>
  );
}

export function TwinGridsDiagram() {
  return (
    <DiagramFigure
      caption={<><strong>Fig. 5</strong> Both grids are windows, and so is live refresh: a change re-queries only what is on screen.</>}
    >
      <svg viewBox="0 0 720 290" role="img" aria-label="SQLite and JSON grids virtualize large datasets and re-query only visible rows when data changes.">
        <defs>
          <marker id="grids-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" data-svg-accent-fill /></marker>
        </defs>
        <GridWindow x={40} title="SQLITE ROW GRID" total="1,000,000 rows" />
        <line x1="150" y1="128" x2="186" y2="128" data-svg-accent markerEnd="url(#grids-accent)" />
        <text x="192" y="112" data-svg-faint>on change:</text>
        <text x="192" y="130" data-svg-accent-text>re-query only</text>
        <text x="192" y="144" data-svg-accent-text>the visible rows</text>
        <text x="192" y="165" data-svg-faint>keyset — row 10M</text>
        <text x="192" y="179" data-svg-faint>costs like row 1</text>

        <line x1="360" y1="36" x2="360" y2="214" data-svg-divider />
        <GridWindow x={408} title="JSON VALUE VIEWER" total="array · 50,000 items" />
        <line x1="518" y1="128" x2="554" y2="128" data-svg-accent markerEnd="url(#grids-accent)" />
        <text x="560" y="112" data-svg-faint>virtualized:</text>
        <text x="560" y="130" data-svg-accent-text>one scroll,</text>
        <text x="560" y="144" data-svg-accent-text>no page buttons</text>
        <text x="560" y="165" data-svg-faint>same window,</text>
        <text x="560" y="179" data-svg-faint>other data</text>

        <text x="360" y="278" textAnchor="middle" data-svg-accent-text>the live refresh is a window too — O(viewport), never O(loaded)</text>
      </svg>
    </DiagramFigure>
  );
}

function GridWindow({ x, title, total }: { x: number; title: string; total: string }) {
  return (
    <g>
      <text x={x - 16} y="26" data-svg-eyebrow data-svg-muted-fill>{title}</text>
      <rect x={x} y="44" width="104" height="168" rx="8" data-svg-stroke />
      {[62, 78, 94, 160, 176, 192].map((y) => <line key={y} x1={x + 12} y1={y} x2={x + 92} y2={y} data-svg-stroke data-svg-thin />)}
      <rect x={x - 6} y="104" width="116" height="48" rx="4" data-svg-accent-wash />
      <line x1={x + 6} y1="121" x2={x + 98} y2="121" data-svg-accent data-svg-thin />
      <line x1={x + 6} y1="136" x2={x + 98} y2="136" data-svg-accent data-svg-thin />
      <text x={x} y="234" data-svg-faint>{total}</text>
      <text x={x} y="250" data-svg-accent-text>≈ 30 nodes</text>
    </g>
  );
}
