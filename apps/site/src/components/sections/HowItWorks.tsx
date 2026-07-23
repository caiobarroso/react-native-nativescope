import type { Step } from "@content/landing";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
import { InstallCommand } from "@/components/ui/InstallCommand";

/**
 * Passos numerados. É uma <ol> de verdade porque a ordem tem significado —
 * a numeração não deve ser desenhada com pseudo-elemento em cima de uma <ul>.
 */
export function HowItWorks({ steps }: { steps: Step[] }) {
  return (
    <section data-how aria-labelledby="how-heading">
      <h2 id="how-heading">Three steps, and there is no fourth</h2>

      <ol data-steps>
        {steps.map((step, index) => (
          <li key={step.title} data-step>
            <span data-step-number aria-hidden>
              {index + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.install || step.run ? (
                <InstallCommand
                  {...(step.install ? { install: step.install } : {})}
                  {...(step.run ? { run: step.run } : {})}
                />
              ) : step.code ? (
                <HighlightedCode code={step.code} language="typescript" />
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
