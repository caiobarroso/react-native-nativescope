import { ArrowRight, Clock, Database, Flag, Globe, ScrollText } from "lucide-react";

/**
 * Explica a Timeline como uma história causal, não como mais uma lista.
 *
 * A leitura é intencionalmente direta:
 *   1. os sinais ficam espalhados;
 *   2. o dev começa por um momento que merece investigação;
 *   3. a Timeline alinha o que aconteceu antes e depois;
 *   4. a relação causal aparece sem comparação mental de timestamps.
 *
 * Cada elemento tem uma keyframe cobrindo o loop inteiro para que o estado
 * estático continue sendo o "depois" completo e legível. Não há JS de timing.
 */
export function TimelineStory() {
  return (
    <div className="tlstory">
      <style>{CSS}</style>

      <div className="tlstory-intro">
        <strong>One moment. Every signal around it.</strong>
        <span>Timeline turns scattered logs, requests and storage writes into one clear story.</span>
      </div>

      <div className="tlstory-stage">
        {/* Antes: a pista está dividida entre superfícies diferentes. */}
        <div className="tlstory-sources">
          <div className="tlstory-panel-label">Scattered signals</div>

          <div className="tlstory-track">
            <span className="tlstory-tracklabel">
              <ScrollText size={14} strokeWidth={1.8} />
              Logs
            </span>
            <span className="tlstory-bars">
              <i className="tlstory-bar tlstory-bar-log" style={{ width: "72%" }} />
              <i className="tlstory-bar tlstory-bar-log" style={{ width: "54%" }} />
            </span>
          </div>

          <div className="tlstory-track">
            <span className="tlstory-tracklabel">
              <Globe size={14} strokeWidth={1.8} />
              Network
            </span>
            <span className="tlstory-bars">
              <i className="tlstory-bar tlstory-bar-net" style={{ width: "64%" }} />
              <i className="tlstory-bar tlstory-bar-net" style={{ width: "44%" }} />
            </span>
          </div>

          <div className="tlstory-track">
            <span className="tlstory-tracklabel">
              <Database size={14} strokeWidth={1.8} />
              Storage
            </span>
            <span className="tlstory-bars">
              <i className="tlstory-bar tlstory-bar-sto" style={{ width: "58%" }} />
            </span>
          </div>

          <span className="tlstory-scatter" aria-hidden>
            One clue in each place.
          </span>
        </div>

        {/* O ponto de entrada fica explícito: qualquer momento pode ser a âncora. */}
        <div className="tlstory-bridge" aria-hidden>
          <span className="tlstory-bridge-label">Choose a moment</span>
          <span className="tlstory-anchor-chip">
            <Flag size={12} strokeWidth={2} />
            401 error
          </span>
          <ArrowRight className="tlstory-bridge-arrow" size={18} strokeWidth={1.5} />
        </div>

        {/* Depois: a mesma janela, ordenada em uma única história. */}
        <div className="tlstory-merged">
          <div className="tlstory-head">
            <span className="tlstory-head-title">
              <Clock size={13} strokeWidth={2} />
              Timeline
            </span>
            <span className="tlstory-head-anchor">around 401</span>
            <span className="tlstory-window">±2s</span>
          </div>

          <div className="tlstory-context" aria-hidden>
            <span>before</span>
            <i />
            <span>the moment</span>
            <i />
            <span>after</span>
          </div>

          <div className="tlstory-row tlstory-r1">
            <span className="tlstory-offset">−2s</span>
            <i className="tlstory-pip tlstory-pip-log" aria-hidden />
            <span className="tlstory-text">[Checkout] starting</span>
          </div>

          <div className="tlstory-row tlstory-r2">
            <span className="tlstory-offset">−2s</span>
            <i className="tlstory-pip tlstory-pip-net" aria-hidden />
            <span className="tlstory-text">POST /login</span>
            <span className="tlstory-badge tlstory-badge-ok">200</span>
          </div>

          <div className="tlstory-row tlstory-r3 tlstory-row-cause">
            <span className="tlstory-offset">−1s</span>
            <i className="tlstory-pip tlstory-pip-sto" aria-hidden />
            <span className="tlstory-text">auth.token</span>
            <span className="tlstory-badge tlstory-badge-sto">saved</span>
          </div>

          <div className="tlstory-row tlstory-r4 tlstory-row-anchor">
            <span className="tlstory-offset">now</span>
            <i className="tlstory-pip tlstory-pip-net" aria-hidden />
            <span className="tlstory-text">GET /me</span>
            <span className="tlstory-badge tlstory-badge-err">401</span>
            <span className="tlstory-anchor-label">starting point</span>
          </div>

          <div className="tlstory-row tlstory-r5">
            <span className="tlstory-offset">+0s</span>
            <i className="tlstory-pip tlstory-pip-err" aria-hidden />
            <span className="tlstory-text tlstory-text-err">Unhandled: refreshing session</span>
          </div>

          <span className="tlstory-bracket" aria-hidden />
        </div>
      </div>

      <p className="tlstory-punch">
        <span className="tlstory-punchdot" aria-hidden />
        <span>
          <strong>The cause is visible in one glance:</strong> the 401 came right after the token
          was saved.
        </span>
      </p>

      <ol className="tlstory-steps" aria-hidden>
        <li className="tlstory-step tlstory-step-1">
          <b>1</b>
          <span>Choose a moment</span>
          <span className="tlstory-progress" />
        </li>
        <li className="tlstory-step tlstory-step-2">
          <b>2</b>
          <span>Everything lines up</span>
          <span className="tlstory-progress" />
        </li>
        <li className="tlstory-step tlstory-step-3">
          <b>3</b>
          <span>See the cause</span>
          <span className="tlstory-progress" />
        </li>
      </ol>

      <div className="tlstory-ways" aria-hidden>
        <div className="tlstory-ways-first">
          <span className="tlstory-ways-label">Choose a moment from:</span>
          <span className="tlstory-way">Mark</span>
          <span className="tlstory-way">error</span>
          <span className="tlstory-way">failed request</span>
          <span className="tlstory-ways-note">or open Timeline directly from any log or request</span>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.tlstory {
  --td: 14s;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.tlstory-intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px;
  color: var(--text);
}
.tlstory-intro strong { font-size: 16px; line-height: 1.25; }
.tlstory-intro > span { color: var(--text-subtle); font-size: 12px; line-height: 1.35; }

.tlstory-stage {
  display: grid;
  grid-template-columns: 174px 128px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

/* ---------- antes: sinais espalhados ---------- */
.tlstory-sources { display: flex; flex-direction: column; gap: 8px; }
.tlstory-panel-label {
  margin-bottom: 1px;
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 700;
}
.tlstory-track {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
  animation: tl-drift var(--td) ease-in-out infinite;
}
.tlstory-track:nth-of-type(3) { animation-delay: .35s; }
.tlstory-track:nth-of-type(4) { animation-delay: .7s; }
.tlstory-tracklabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.tlstory-bars { display: flex; flex-direction: column; gap: 4px; }
.tlstory-bar { height: 6px; border-radius: 999px; opacity: .55; }
.tlstory-bar-log { background: var(--text-subtle); }
.tlstory-bar-net { background: var(--accent); }
.tlstory-bar-sto { background: var(--created); }
.tlstory-scatter {
  margin-top: 1px;
  color: var(--text-subtle);
  font-size: 10px;
  font-style: italic;
  line-height: 1.3;
  text-align: center;
}

/* ---------- entrada e transformação ---------- */
.tlstory-bridge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.tlstory-bridge-label {
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  animation: tl-bridge-label var(--td) ease-out infinite;
}
.tlstory-anchor-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--deleted) 40%, var(--border));
  border-radius: 999px;
  background: var(--deleted-wash);
  color: var(--deleted);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
  animation: tl-anchor-chip var(--td) ease-out infinite;
}
.tlstory-bridge-arrow {
  color: var(--accent);
  animation: tl-bridge-arrow var(--td) ease-in-out infinite;
}

/* ---------- depois: uma história com janela explícita ---------- */
.tlstory-merged {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--text) 5%, transparent);
}
.tlstory-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 13px;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent-wash) 55%, transparent);
  color: var(--accent);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 700;
}
.tlstory-head-title { display: inline-flex; align-items: center; gap: 6px; }
.tlstory-head-anchor {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tlstory-window {
  flex-shrink: 0;
  margin-left: auto;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-raised);
  color: var(--text-subtle);
  font-size: 10px;
}
.tlstory-context {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 13px;
  color: var(--text-subtle);
  font-size: 9px;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.tlstory-context i { width: 4px; height: 1px; background: var(--border-strong); }
.tlstory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  opacity: 0;
  transform: translateX(-8px);
}
.tlstory-offset {
  width: 24px;
  flex-shrink: 0;
  color: var(--text-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.tlstory-pip { width: 7px; height: 7px; flex-shrink: 0; border-radius: 999px; }
.tlstory-pip-log { background: var(--text-subtle); }
.tlstory-pip-net { background: var(--accent); }
.tlstory-pip-sto { background: var(--created); }
.tlstory-pip-err { background: var(--deleted); }
.tlstory-text { min-width: 0; flex: 1; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.tlstory-text-err { color: var(--deleted); }
.tlstory-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .03em;
}
.tlstory-badge-ok, .tlstory-badge-sto { color: var(--created); background: var(--created-wash); }
.tlstory-badge-err { color: var(--deleted); background: var(--deleted-wash); }
.tlstory-row-anchor {
  position: relative;
  background: color-mix(in srgb, var(--deleted-wash) 65%, transparent);
  box-shadow: inset 2px 0 var(--deleted);
}
.tlstory-anchor-label {
  flex-shrink: 0;
  color: var(--deleted);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.tlstory-r1 { animation: tl-row1 var(--td) ease-out infinite; }
.tlstory-r2 { animation: tl-row2 var(--td) ease-out infinite; }
.tlstory-r3 { animation: tl-row3 var(--td) ease-out infinite; }
.tlstory-r4 { animation: tl-row4 var(--td) ease-out infinite; }
.tlstory-r5 { animation: tl-row5 var(--td) ease-out infinite; }

/* O colchete transforma proximidade temporal em relação causal visível. */
.tlstory-bracket {
  position: absolute;
  top: 124px;
  left: 5px;
  width: 8px;
  height: 34px;
  border: 2px solid var(--accent);
  border-right: 0;
  border-radius: 5px 0 0 5px;
  opacity: 0;
  transform: translateX(-5px);
  animation: tl-bracket var(--td) ease-out infinite;
}

/* ---------- insight ---------- */
.tlstory-punch {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--accent-wash) 45%, transparent);
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.45;
  opacity: 0;
  transform: translateY(4px);
  animation: tl-punch var(--td) ease-out infinite;
}
.tlstory-punch strong { color: var(--accent); }
.tlstory-punchdot { width: 8px; height: 8px; flex-shrink: 0; margin-top: 5px; border-radius: 999px; background: var(--accent); }

/* ---------- roteiro curto ---------- */
.tlstory-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 0; padding: 0; list-style: none; }
.tlstory-step { position: relative; display: flex; align-items: center; gap: 8px; padding-bottom: 10px; color: var(--text-subtle); font-size: 12px; }
.tlstory-step b {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-sunken);
  color: var(--text-subtle);
  font-size: 11px;
}
.tlstory-step span { line-height: 1.2; }
.tlstory-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; border-radius: 2px; background: var(--accent); transform: scaleX(0); transform-origin: left; }
.tlstory-step-1 { animation: tl-lit1 var(--td) linear infinite; }
.tlstory-step-2 { animation: tl-lit2 var(--td) linear infinite; }
.tlstory-step-3 { animation: tl-lit3 var(--td) linear infinite; }
.tlstory-step-1 b { animation: tl-num1 var(--td) linear infinite; }
.tlstory-step-2 b { animation: tl-num2 var(--td) linear infinite; }
.tlstory-step-3 b { animation: tl-num3 var(--td) linear infinite; }
.tlstory-step-1 .tlstory-progress { animation: tl-bar1 var(--td) linear infinite; }
.tlstory-step-2 .tlstory-progress { animation: tl-bar2 var(--td) linear infinite; }
.tlstory-step-3 .tlstory-progress { animation: tl-bar3 var(--td) linear infinite; }

.tlstory-ways { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: -8px; }
.tlstory-ways-first {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 26px;
  margin-left: 29px;
  padding: 4px 0 4px 10px;
  border-left: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}
.tlstory-ways-label { width: 100%; color: var(--text-subtle); font-size: 10px; line-height: 1.2; }
.tlstory-way { color: var(--text-subtle); font-size: 10px; }
.tlstory-way:not(:last-child)::after { margin-left: 5px; color: var(--border-strong); content: "·"; }
.tlstory-ways-note { width: 100%; color: var(--text-subtle); font-size: 10px; font-style: italic; line-height: 1.2; }

/* ---------- keyframes ---------- */
@keyframes tl-drift {
  0%, 10% { opacity: 1; transform: translateX(0); }
  22%, 64% { opacity: .52; transform: translateX(3px); }
  90%, 100% { opacity: 1; transform: translateX(0); }
}
@keyframes tl-bridge-label { 0%, 12% { opacity: 0; transform: translateY(4px); } 18%, 88% { opacity: 1; transform: translateY(0); } 96%, 100% { opacity: 0; transform: translateY(4px); } }
@keyframes tl-anchor-chip { 0%, 16% { opacity: 0; transform: scale(.9); } 23%, 88% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; transform: scale(.9); } }
@keyframes tl-bridge-arrow { 0%, 20% { opacity: .25; transform: translateX(-4px); } 34%, 55% { opacity: 1; transform: translateX(4px); } 70%, 100% { opacity: .3; transform: translateX(0); } }
@keyframes tl-row1 { 0%, 24% { opacity: 0; transform: translateX(-8px); } 29%, 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-8px); } }
@keyframes tl-row2 { 0%, 29% { opacity: 0; transform: translateX(-8px); } 34%, 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-8px); } }
@keyframes tl-row3 { 0%, 34% { opacity: 0; transform: translateX(-8px); } 39%, 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-8px); } }
@keyframes tl-row4 { 0%, 39% { opacity: 0; transform: translateX(-8px); } 44%, 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-8px); } }
@keyframes tl-row5 { 0%, 44% { opacity: 0; transform: translateX(-8px); } 49%, 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-8px); } }
@keyframes tl-bracket { 0%, 54% { opacity: 0; transform: translateX(-5px); } 60% { opacity: 1; transform: translateX(0); } 87% { opacity: 1; transform: translateX(0); } 94%, 100% { opacity: 0; transform: translateX(-5px); } }
@keyframes tl-punch { 0%, 57% { opacity: 0; transform: translateY(4px); } 63%, 87% { opacity: 1; transform: translateY(0); } 94%, 100% { opacity: 0; transform: translateY(4px); } }
@keyframes tl-lit1 { 0%, 15% { color: var(--text); } 20%, 100% { color: var(--text-subtle); } }
@keyframes tl-lit2 { 0%, 18% { color: var(--text-subtle); } 24%, 46% { color: var(--text); } 52%, 100% { color: var(--text-subtle); } }
@keyframes tl-lit3 { 0%, 48% { color: var(--text-subtle); } 54%, 100% { color: var(--text); } }
@keyframes tl-num1 { 0%, 15% { background: var(--accent); color: #fff; border-color: var(--accent); } 20%, 100% { background: var(--surface-sunken); color: var(--text-subtle); border-color: var(--border); } }
@keyframes tl-num2 { 0%, 18% { background: var(--surface-sunken); color: var(--text-subtle); border-color: var(--border); } 24%, 46% { background: var(--accent); color: #fff; border-color: var(--accent); } 52%, 100% { background: var(--surface-sunken); color: var(--text-subtle); border-color: var(--border); } }
@keyframes tl-num3 { 0%, 48% { background: var(--surface-sunken); color: var(--text-subtle); border-color: var(--border); } 54%, 100% { background: var(--accent); color: #fff; border-color: var(--accent); } }
@keyframes tl-bar1 { 0% { transform: scaleX(0); } 5%, 18% { transform: scaleX(1); } 20%, 100% { transform: scaleX(0); } }
@keyframes tl-bar2 { 0%, 18% { transform: scaleX(0); } 25%, 48% { transform: scaleX(1); } 50%, 100% { transform: scaleX(0); } }
@keyframes tl-bar3 { 0%, 48% { transform: scaleX(0); } 55%, 92% { transform: scaleX(1); } 100% { transform: scaleX(0); } }

@media (prefers-reduced-motion: reduce) {
  .tlstory * { animation: none !important; }
  .tlstory-row, .tlstory-bracket, .tlstory-punch { opacity: 1 !important; transform: none !important; }
  .tlstory-track { opacity: .6; }
  .tlstory-step-3 { color: var(--text); }
  .tlstory-step-3 b { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tlstory-step-3 .tlstory-progress { transform: scaleX(1); }
}
`;
