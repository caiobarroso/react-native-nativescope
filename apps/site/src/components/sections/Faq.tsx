import type { FaqItem } from "@content/landing";

/**
 * FAQ em <details>. Nativo de propósito: abre sem JavaScript, é acessível por
 * padrão e é encontrável pelo Ctrl+F do navegador quando aberto.
 *
 * Se a implementação de design trocar por um acordeão custom, ela precisa
 * reproduzir tudo isso — o que raramente compensa.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <section data-faq aria-labelledby="faq-heading">
      <h2 id="faq-heading">Questions worth answering directly</h2>

      <div data-faq-list>
        {items.map((item) => (
          <details key={item.question} data-faq-item>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
