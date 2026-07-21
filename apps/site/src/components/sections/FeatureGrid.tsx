import type { Feature } from "@content/landing";
import { Icon } from "@/components/ui/Icon";

export function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <section data-features aria-labelledby="features-heading">
      <header data-features-head>
        <h2 id="features-heading">What you get</h2>
        <p>
          A focused toolkit for understanding, editing, and stress-testing the data your React
          Native app keeps on device.
        </p>
      </header>

      <ul data-feature-grid>
        {features.map((feature) => (
          <li key={feature.title} data-feature-card>
            <Icon name={feature.icon} size={22} />
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
