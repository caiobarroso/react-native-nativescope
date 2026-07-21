import { Github, Quote } from "lucide-react";

export function Founder() {
  return (
    <section data-founder aria-labelledby="founder-title">
      <div data-founder-photo aria-hidden>
        <span>CB</span>
      </div>
      <div data-founder-copy>
        <Quote size={22} aria-hidden />
        <h2 id="founder-title">Built because I needed it.</h2>
        <p>
          I was tired of guessing what a React Native app had actually stored, scattering logs
          through the code, and rebuilding screens just to inspect one value. NativeScope is the
          tool I wanted to install once and forget about until the moment I needed it.
        </p>
        <p>
          I build it in the open, with one standard: the easiest tool to adopt should also be the
          one you can trust with real data.
        </p>
        <div data-founder-signature>
          <div><strong>Caio Barroso</strong><span>Creator of NativeScope</span></div>
          <a
            href="https://github.com/caiobarroso"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Caio Barroso on GitHub"
          >
            <Github size={18} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
