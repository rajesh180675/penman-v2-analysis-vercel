import { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import { ScenarioCard } from "./atoms";

export default function ScenarioCardsSection({
  commandCenter,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-4">
      {commandCenter.scenarios.map((scenario) => (
        <ScenarioCard
          key={scenario.key}
          label={scenario.label}
          intrinsicPerShare={scenario.intrinsicPerShare}
          upsidePct={scenario.upsidePct}
          marginOfSafetyPct={scenario.marginOfSafetyPct}
          expectedCagr={scenario.expectedCagr}
          ke={scenario.assumptions.ke}
          kw={scenario.assumptions.kw}
          g={scenario.assumptions.g}
          salesGrowth={scenario.assumptions.salesGrowthYear1}
          corePm={scenario.assumptions.corePmYear1}
          reinvestmentRate={scenario.assumptions.reinvestmentRateYear1}
          incrementalRoic={scenario.assumptions.incrementalRoicYear1}
          forecastPolicy={scenario.forecastPolicy}
        />
      ))}
    </section>
  );
}
