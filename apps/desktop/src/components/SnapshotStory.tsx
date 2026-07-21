import { Camera, RotateCcw, ShoppingCart } from "lucide-react";

/**
 * Explica o valor do snapshot num cenário rotineiro, em loop lento (~12s):
 * você adiciona um item ao carrinho no app — o carrinho pula 2→3 na tela E no
 * storage — e a ferramenta destaca, uma a uma, cada coisa que aquela ação mexeu
 * (mudou / criou / removeu), com undo em cada. Reusa a linguagem created/
 * updated/deleted do produto.
 *
 * Sem JS de timing: cada elemento tem uma keyframe cobrindo o loop inteiro, então
 * fecha sozinho. Estado-base (sem animação) já mostra o "antes" coerente, e
 * `prefers-reduced-motion` congela no "depois" (o diff legível, sem movimento).
 */
export function SnapshotStory() {
  return (
    <div className="snapstory">
      <style>{CSS}</style>

      <div className="snapstory-stage">
        {/* App: um cenário que qualquer um reconhece */}
        <div className="snapstory-phone">
          <span className="snapstory-notch" aria-hidden />
          <div className="snapstory-screen">
            <div className="snapstory-shoptop">
              <span className="snapstory-shopname">Shop</span>
              <span className="snapstory-cart" aria-hidden>
                <ShoppingCart size={15} strokeWidth={1.7} />
                <span className="snapstory-cartbadge">
                  <b className="snapstory-c2">2</b>
                  <b className="snapstory-c3">3</b>
                </span>
              </span>
            </div>

            <div className="snapstory-product">
              <span className="snapstory-thumb" aria-hidden />
              <div className="snapstory-pinfo">
                <span className="snapstory-pname">Sneakers</span>
                <span className="snapstory-pprice">$60</span>
              </div>
            </div>

            <button className="snapstory-cta" type="button" tabIndex={-1}>
              <ShoppingCart size={13} strokeWidth={2} />
              Add to cart
              <span className="snapstory-ripple" aria-hidden />
            </button>
            <span className="snapstory-tap" aria-hidden />
          </div>
        </div>

        <div className="snapstory-arrow" aria-hidden>
          <span className="snapstory-dot" />
          <span className="snapstory-dot" />
          <span className="snapstory-dot" />
        </div>

        {/* Storage: a mesma ação, capturada */}
        <div className="snapstory-store">
          <span className="snapstory-shutter" aria-hidden />
          <div className="snapstory-storehead">
            <Camera size={12} strokeWidth={1.6} />
            <span>cart storage</span>
          </div>

          <div className="snapstory-row snapstory-row-chg">
            <span className="snapstory-wash snapstory-wash-chg" aria-hidden />
            <span className="snapstory-key">Items in cart</span>
            <span className="snapstory-val">
              <b>2</b>
              <em className="snapstory-to">→</em>
              <b className="snapstory-new3">3</b>
            </span>
            <span className="snapstory-pill snapstory-pill-chg">changed</span>
            <span className="snapstory-undo" aria-hidden>
              <RotateCcw size={10} strokeWidth={1.8} />
            </span>
          </div>

          <div className="snapstory-row snapstory-row-new">
            <span className="snapstory-wash snapstory-wash-new" aria-hidden />
            <span className="snapstory-key">Sneakers</span>
            <span className="snapstory-val snapstory-val-muted">in cart</span>
            <span className="snapstory-pill snapstory-pill-new">new</span>
            <span className="snapstory-undo" aria-hidden>
              <RotateCcw size={10} strokeWidth={1.8} />
            </span>
          </div>

          <div className="snapstory-row snapstory-row-del">
            <span className="snapstory-wash snapstory-wash-del" aria-hidden />
            <span className="snapstory-key snapstory-fade">Saved for later</span>
            <span className="snapstory-val snapstory-val-muted snapstory-fade">
              <span className="snapstory-strike">Sneakers</span>
            </span>
            <span className="snapstory-pill snapstory-pill-del">removed</span>
            <span className="snapstory-undo" aria-hidden>
              <RotateCcw size={10} strokeWidth={1.8} />
            </span>
          </div>
        </div>
      </div>

      <ol className="snapstory-steps" aria-hidden>
        <li className="snapstory-step snapstory-step-1">
          <b>1</b>
          <span>Take a snapshot</span>
          <span className="snapstory-bar" />
        </li>
        <li className="snapstory-step snapstory-step-2">
          <b>2</b>
          <span>Add to cart in your app</span>
          <span className="snapstory-bar" />
        </li>
        <li className="snapstory-step snapstory-step-3">
          <b>3</b>
          <span>See exactly what changed</span>
          <span className="snapstory-bar" />
        </li>
      </ol>
    </div>
  );
}

const CSS = `
.snapstory { --sd: 12s; display: flex; flex-direction: column; gap: 22px; }
.snapstory-stage { display: grid; grid-template-columns: 156px 36px 1fr; align-items: center; gap: 12px; }

/* ---------- phone ---------- */
.snapstory-phone {
  position: relative; height: 208px; padding: 8px;
  border: 1px solid var(--border-strong); border-radius: 28px; background: var(--surface-sunken);
}
.snapstory-notch {
  position: absolute; top: 13px; left: 50%; transform: translateX(-50%);
  width: 46px; height: 11px; border-radius: 999px; background: var(--border-strong);
}
.snapstory-screen {
  position: relative; height: 100%; padding: 22px 12px 14px; border-radius: 22px;
  background: var(--surface); display: flex; flex-direction: column; gap: 10px;
}
.snapstory-shoptop { display: flex; align-items: center; }
.snapstory-shopname { font-size: 13px; font-weight: 700; color: var(--text); }
.snapstory-cart { position: relative; margin-left: auto; color: var(--text-muted); }
.snapstory-cartbadge {
  position: absolute; top: -6px; right: -8px; display: grid; place-items: center;
  min-width: 15px; height: 15px; padding: 0 3px; border-radius: 999px;
  background: var(--accent); color: #fff; font-size: 9px; font-weight: 700;
}
.snapstory-cartbadge b { grid-area: 1 / 1; }
.snapstory-c2 { animation: ss-c2 var(--sd) ease-out infinite; }
.snapstory-c3 { opacity: 0; animation: ss-c3 var(--sd) ease-out infinite; }

.snapstory-product {
  display: flex; align-items: center; gap: 9px; padding: 9px;
  border: 1px solid var(--border); border-radius: 12px; background: var(--surface-sunken);
}
.snapstory-thumb {
  width: 38px; height: 38px; border-radius: 8px; flex-shrink: 0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 40%, var(--surface)), var(--surface-hover));
}
.snapstory-pinfo { display: flex; flex-direction: column; gap: 2px; }
.snapstory-pname { font-size: 12px; font-weight: 600; color: var(--text); }
.snapstory-pprice { font-size: 11px; color: var(--text-muted); }

.snapstory-cta {
  position: relative; overflow: hidden; margin-top: auto;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; border: 0; border-radius: 11px;
  background: var(--accent); color: #fff; font-size: 12px; font-weight: 600;
  transform-origin: center; animation: ss-press var(--sd) ease-in-out infinite;
}
.snapstory-ripple {
  position: absolute; inset: 0; margin: auto; width: 10px; height: 10px; border-radius: 999px;
  background: rgba(255,255,255,.55); opacity: 0; transform: scale(0);
  animation: ss-ripple var(--sd) ease-out infinite;
}
.snapstory-tap {
  position: absolute; left: 50%; bottom: 20px; width: 20px; height: 20px; border-radius: 999px;
  background: color-mix(in srgb, var(--text) 55%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--text) 16%, transparent);
  opacity: 0; transform: translate(-50%, 12px); animation: ss-tap var(--sd) ease-out infinite;
}

/* ---------- connector ---------- */
.snapstory-arrow { display: flex; align-items: center; justify-content: center; gap: 5px; }
.snapstory-dot { width: 5px; height: 5px; border-radius: 999px; background: var(--border-strong); }
.snapstory-dot:nth-child(1) { animation: ss-dot var(--sd) ease-in-out infinite; }
.snapstory-dot:nth-child(2) { animation: ss-dot var(--sd) ease-in-out infinite .14s; }
.snapstory-dot:nth-child(3) { animation: ss-dot var(--sd) ease-in-out infinite .28s; }

/* ---------- storage ---------- */
.snapstory-store {
  position: relative; overflow: hidden;
  border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
}
.snapstory-shutter {
  position: absolute; inset: 0; z-index: 6; pointer-events: none;
  background: var(--accent); opacity: 0; animation: ss-shutter var(--sd) ease-out infinite;
}
.snapstory-storehead {
  display: flex; align-items: center; gap: 6px; padding: 9px 13px;
  border-bottom: 1px solid var(--border); color: var(--text-muted);
  font-size: 11px; font-weight: 600; font-family: var(--font-mono, ui-monospace, monospace);
}
.snapstory-row {
  position: relative; display: flex; align-items: center; gap: 9px;
  height: 42px; padding: 0 13px; border-bottom: 1px solid var(--border); font-size: 12.5px;
}
.snapstory-row:last-child { border-bottom: 0; }
.snapstory-row-new { max-height: 0; overflow: hidden; opacity: 0; animation: ss-rownew var(--sd) ease-out infinite; }

.snapstory-wash { position: absolute; inset: 0; z-index: 0; opacity: 0; pointer-events: none; }
.snapstory-wash-chg { background: var(--accent-wash); animation: ss-hold-a var(--sd) ease-out infinite; }
.snapstory-wash-new { background: var(--created-wash); animation: ss-hold-b var(--sd) ease-out infinite; }
.snapstory-wash-del { background: var(--deleted-wash); animation: ss-hold-c var(--sd) ease-out infinite; }

.snapstory-key { position: relative; z-index: 1; flex: 1; min-width: 0; color: var(--text); font-weight: 500; }
.snapstory-val { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 5px; color: var(--text); font-variant-numeric: tabular-nums; }
.snapstory-val-muted { color: var(--text-muted); }
.snapstory-to, .snapstory-new3 { opacity: 0; }
.snapstory-to { color: var(--text-subtle); animation: ss-valnew var(--sd) ease-out infinite; }
.snapstory-new3 { font-weight: 700; color: var(--updated); animation: ss-valnew var(--sd) ease-out infinite; }
.snapstory-fade { animation: ss-fade-c var(--sd) ease-out infinite; }
.snapstory-strike { position: relative; }
.snapstory-strike::after {
  content: ""; position: absolute; top: 52%; left: 0; width: 0; height: 1.5px;
  background: var(--deleted); animation: ss-strike var(--sd) ease-out infinite;
}

.snapstory-pill {
  position: relative; z-index: 1; padding: 2px 7px; border-radius: 999px;
  font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  opacity: 0; transform: scale(.7);
}
.snapstory-pill-chg { color: var(--updated); background: color-mix(in srgb, var(--updated) 16%, transparent); animation: ss-pill-a var(--sd) ease-out infinite; }
.snapstory-pill-new { color: var(--created); background: var(--created-wash); animation: ss-pill-b var(--sd) ease-out infinite; }
.snapstory-pill-del { color: var(--deleted); background: var(--deleted-wash); animation: ss-pill-c var(--sd) ease-out infinite; }

.snapstory-undo {
  position: relative; z-index: 1; display: grid; place-items: center; width: 21px; height: 21px;
  border-radius: 6px; color: var(--text-muted);
  border: 1px solid var(--border); background: var(--surface-raised);
  opacity: 0; transform: translateX(4px);
}
.snapstory-row-chg .snapstory-undo { animation: ss-undo-a var(--sd) ease-out infinite; }
.snapstory-row-new .snapstory-undo { animation: ss-undo-b var(--sd) ease-out infinite; }
.snapstory-row-del .snapstory-undo { animation: ss-undo-c var(--sd) ease-out infinite; }

/* ---------- steps ---------- */
.snapstory-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0; padding: 0; list-style: none; }
.snapstory-step { position: relative; display: flex; align-items: center; gap: 8px; padding-bottom: 10px; font-size: 11.5px; color: var(--text-subtle); }
.snapstory-step b {
  display: grid; place-items: center; width: 18px; height: 18px; flex-shrink: 0; border-radius: 999px;
  font-size: 10px; font-weight: 700; color: var(--text-subtle);
  background: var(--surface-sunken); border: 1px solid var(--border);
}
.snapstory-step span { line-height: 1.2; }
.snapstory-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; border-radius: 2px; background: var(--accent); transform-origin: left; transform: scaleX(0); }
.snapstory-step-1 { animation: ss-lit1 var(--sd) linear infinite; }
.snapstory-step-2 { animation: ss-lit2 var(--sd) linear infinite; }
.snapstory-step-3 { animation: ss-lit3 var(--sd) linear infinite; }
.snapstory-step-1 b { animation: ss-num1 var(--sd) linear infinite; }
.snapstory-step-2 b { animation: ss-num2 var(--sd) linear infinite; }
.snapstory-step-3 b { animation: ss-num3 var(--sd) linear infinite; }
.snapstory-step-1 .snapstory-bar { animation: ss-bar1 var(--sd) linear infinite; }
.snapstory-step-2 .snapstory-bar { animation: ss-bar2 var(--sd) linear infinite; }
.snapstory-step-3 .snapstory-bar { animation: ss-bar3 var(--sd) linear infinite; }

/* ---------- keyframes ---------- */
@keyframes ss-shutter { 0%,6%{opacity:0} 9%{opacity:.3} 15%{opacity:0} 100%{opacity:0} }
@keyframes ss-tap {
  0%,26%{opacity:0; transform:translate(-50%,12px) scale(1.3)}
  30%{opacity:.85; transform:translate(-50%,0) scale(1)}
  34%{opacity:.85; transform:translate(-50%,0) scale(.7)}
  40%{opacity:.5; transform:translate(-50%,0) scale(1)}
  46%,100%{opacity:0; transform:translate(-50%,12px) scale(1.3)}
}
@keyframes ss-press { 0%,31%{transform:scale(1)} 35%{transform:scale(.96)} 40%{transform:scale(1)} 100%{transform:scale(1)} }
@keyframes ss-ripple { 0%,32%{opacity:0; transform:scale(0)} 36%{opacity:.5; transform:scale(1)} 48%{opacity:0; transform:scale(11)} 100%{opacity:0; transform:scale(11)} }
@keyframes ss-c2 { 0%,33%{opacity:1; transform:scale(1)} 37%{opacity:0; transform:scale(.5)} 96%{opacity:0} 100%{opacity:1; transform:scale(1)} }
@keyframes ss-c3 { 0%,33%{opacity:0; transform:scale(.4)} 37%{opacity:1; transform:scale(1.35)} 41%{transform:scale(1)} 96%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(.4)} }
@keyframes ss-dot { 0%,24%{opacity:.3; transform:translateX(0)} 34%{opacity:1; transform:translateX(3px)} 50%,100%{opacity:.3; transform:translateX(0)} }

@keyframes ss-valnew { 0%,50%{opacity:0; transform:translateX(-3px)} 56%{opacity:1; transform:translateX(0)} 95%{opacity:1} 99%{opacity:0} 100%{opacity:0} }
@keyframes ss-hold-a { 0%,50%{opacity:0} 56%{opacity:1} 94%{opacity:1} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-pill-a { 0%,50%{opacity:0; transform:scale(.7)} 56%{opacity:1; transform:scale(1)} 94%{opacity:1; transform:scale(1)} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-undo-a { 0%,80%{opacity:0; transform:translateX(4px)} 85%{opacity:1; transform:translateX(0)} 95%{opacity:1} 99%{opacity:0} 100%{opacity:0} }

@keyframes ss-rownew { 0%,58%{max-height:0; opacity:0} 64%{max-height:44px; opacity:1} 94%{max-height:44px; opacity:1} 98%{max-height:0; opacity:0} 100%{max-height:0; opacity:0} }
@keyframes ss-hold-b { 0%,60%{opacity:0} 66%{opacity:1} 94%{opacity:1} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-pill-b { 0%,60%{opacity:0; transform:scale(.7)} 66%{opacity:1; transform:scale(1)} 94%{opacity:1; transform:scale(1)} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-undo-b { 0%,81%{opacity:0; transform:translateX(4px)} 86%{opacity:1; transform:translateX(0)} 95%{opacity:1} 99%{opacity:0} 100%{opacity:0} }

@keyframes ss-fade-c { 0%,66%{opacity:1} 73%{opacity:.5} 94%{opacity:.5} 98%{opacity:1} 100%{opacity:1} }
@keyframes ss-strike { 0%,67%{width:0} 74%{width:100%} 94%{width:100%} 98%{width:0} 100%{width:0} }
@keyframes ss-hold-c { 0%,66%{opacity:0} 72%{opacity:1} 94%{opacity:1} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-pill-c { 0%,66%{opacity:0; transform:scale(.7)} 72%{opacity:1; transform:scale(1)} 94%{opacity:1; transform:scale(1)} 98%{opacity:0} 100%{opacity:0} }
@keyframes ss-undo-c { 0%,82%{opacity:0; transform:translateX(4px)} 87%{opacity:1; transform:translateX(0)} 95%{opacity:1} 99%{opacity:0} 100%{opacity:0} }

@keyframes ss-lit1 { 0%,22%{color:var(--text)} 26%,100%{color:var(--text-subtle)} }
@keyframes ss-lit2 { 0%,24%{color:var(--text-subtle)} 28%,46%{color:var(--text)} 50%,100%{color:var(--text-subtle)} }
@keyframes ss-lit3 { 0%,48%{color:var(--text-subtle)} 52%,100%{color:var(--text)} }
@keyframes ss-num1 { 0%,22%{background:var(--accent); color:#fff; border-color:var(--accent)} 26%,100%{background:var(--surface-sunken); color:var(--text-subtle); border-color:var(--border)} }
@keyframes ss-num2 { 0%,24%{background:var(--surface-sunken); color:var(--text-subtle); border-color:var(--border)} 28%,46%{background:var(--accent); color:#fff; border-color:var(--accent)} 50%,100%{background:var(--surface-sunken); color:var(--text-subtle); border-color:var(--border)} }
@keyframes ss-num3 { 0%,48%{background:var(--surface-sunken); color:var(--text-subtle); border-color:var(--border)} 52%,100%{background:var(--accent); color:#fff; border-color:var(--accent)} }
@keyframes ss-bar1 { 0%{transform:scaleX(0)} 6%,24%{transform:scaleX(1)} 25%,100%{transform:scaleX(0)} }
@keyframes ss-bar2 { 0%,24%{transform:scaleX(0)} 30%,48%{transform:scaleX(1)} 49%,100%{transform:scaleX(0)} }
@keyframes ss-bar3 { 0%,48%{transform:scaleX(0)} 54%,96%{transform:scaleX(1)} 100%{transform:scaleX(0)} }

@media (prefers-reduced-motion: reduce) {
  .snapstory * { animation: none !important; }
  .snapstory-c2 { display: none; }
  .snapstory-c3 { opacity: 1; }
  .snapstory-to, .snapstory-new3, .snapstory-wash, .snapstory-pill, .snapstory-undo { opacity: 1 !important; transform: none !important; }
  .snapstory-row-new { max-height: 44px; opacity: 1; }
  .snapstory-fade { opacity: .55; }
  .snapstory-strike::after { width: 100%; }
  .snapstory-shutter, .snapstory-ripple, .snapstory-tap { opacity: 0 !important; }
  .snapstory-step-3 { color: var(--text); }
  .snapstory-step-3 b { background: var(--accent); color: #fff; border-color: var(--accent); }
  .snapstory-step-3 .snapstory-bar { transform: scaleX(1); }
}
`;
