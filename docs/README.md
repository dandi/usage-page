# Region codes

The geographic section reads `by_region.tsv`, whose regions are ISO 3166-1
alpha-3 country codes and ISO 3166-2 subdivision codes (`USA/CA`, `DNK/84`).
`src/configs/region_info.json` is what turns those into place names and into
the GADM boundaries the choropleth draws.  It is generated, so regenerate it
rather than editing it — after the boundaries change, or when new codes appear
upstream:

```bash
npm run build:region-info
```

## Where its contents come from

| Field | Source |
| --- | --- |
| `alpha3_to_alpha2` | The ISO 3166-1 register, via the [`iso-3166`](https://www.npmjs.com/package/iso-3166) package (MIT). |
| `alpha2_to_country_name` | Unicode CLDR, via the ICU data Node itself carries (`Intl.DisplayNames`). |
| `subdivisions[..][0]`, the name | Unicode CLDR subdivision names, via the [`cldr-subdivisions-full`](https://www.npmjs.com/package/cldr-subdivisions-full) package (Unicode-3.0). |
| `subdivisions[..][1]`, the boundary | Not a dataset: computed by the generator, see below. |

Two things in the file come from neither register.  Kosovo has no ISO 3166-1
entry but the summaries report it, so the generator adds the user-assigned
`XKX`/`XK` pair by hand.  And CLDR names no subdivision at all of a few small
territories (BM, MP, NC, PF, VI), whose codes therefore carry a null name; the
page shows the bare code for those rather than inventing one.

Nothing published anywhere maps an ISO 3166-2 code to a GADM boundary, which is
why the boundary half is computed rather than looked up.  The generator takes
the subdivision's coordinates from the upstream `region_codes_to_coordinates.yaml`
— the same file the points view plots — and finds which of that country's GADM
polygons **contains** that point.  This is what lets the mapping survive the two
datasets dividing a country differently: ISO 3166-2 lists nineteen regions of
Finland where GADM draws five, and each of the nineteen falls inside one of the
five.

Containment is the only test, and two kinds of coordinate are refused outright:

- **A point outside every boundary of its country.**  Falling back to the
  *nearest* boundary was tried and dropped: it rescued a few islands off a
  simplified coastline, but it also placed Jammu and Kashmir in Himachal Pradesh
  and Azad Kashmir in Islamabad.
- **A point several of a country's subdivisions share.**  That is not a
  subdivision's position but the fallback the upstream geocoder reaches for when
  it cannot place a code, usually the middle of the country.  All sixteen Polish
  voivodeships carry one such point, as do all fourteen Czech regions; taken at
  face value they would file a whole country's traffic under whichever region
  happens to cover its centre.

A code left without a boundary is matched by name at runtime instead, against
`src/configs/name_aliases.json` — a comparison rather than a guess — and a code
that matches nothing simply goes unpainted, which is the honest outcome.  Of the
160 codes the second rule refuses, 115 land on the right region by name.
