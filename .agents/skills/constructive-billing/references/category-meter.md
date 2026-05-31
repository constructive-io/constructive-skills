# Category Meters

Category-based meter grouping for billing.

## Concept

Category meters group related individual meters under a shared category. This enables aggregate billing views — e.g., grouping `llm_input_tokens`, `llm_output_tokens`, and `llm_image_tokens` under an `ai` category.

## Configuration

Categories are defined on the meter record and propagate to balance and usage summary views. A meter belongs to exactly one category (or none).

## Usage

Category meters are used for:
- Dashboard aggregation (show total AI spend vs total storage spend)
- Plan-level caps (cap total AI usage across all AI meters)
- Reporting and invoicing grouped by category
