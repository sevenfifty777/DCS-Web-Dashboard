"use client";

import { DECK_SPOT_LEGEND } from './deckSpots';

export function DeckSpotLegend() {
  return (
    <div className="ab-deck-spot-legend" aria-label="Deck spot color legend">
      {DECK_SPOT_LEGEND.map((legendItem) => (
        <span className="ab-deck-spot-legend-item" key={legendItem.legendLabel}>
          <span
            className="ab-deck-spot-legend-marker"
            style={{ backgroundColor: legendItem.color }}
          />
          {legendItem.legendLabel}
        </span>
      ))}
    </div>
  );
}
