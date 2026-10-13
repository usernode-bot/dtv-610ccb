# Dtv brand icons

One mark, three images. The mark is a rounded retro TV with a tilted
clapperboard band (three stripes) on top and a play triangle inside a rounded
screen. Flat fills only: no gradients, shadows, strokes or text.

## Files

| File | Size | Ground | Mark | Cut-outs (stripes, screen) | Play triangle |
| --- | --- | --- | --- | --- | --- |
| `icon.svg` / `icon.png` | 1024×1024 | Black `#000000` | Yellow `#FFEE6F` | Black | Yellow |
| `featured-light.svg` / `featured-light.png` | 1280×720 | Cream `#FFFEEA` | Black | Cream | Black |
| `featured-dark.svg` / `featured-dark.png` | 1280×720 | Black | Yellow | Black | Yellow |

Only these three palette colours are used, in the Homeroom brand pairings
Black + Yellow (app icon, dark featured) and Cream + Black (light featured).
Anti-aliased edges are blends of the two colours in each image and nothing else.

`icon.png` is wired as `icon.image` in `dapp.json`; the `🎬` emoji stays as the
fallback if the image ever fails to load. The icon PNG must stay 256 KB or
smaller (it is ~22 KB).

## Geometry

All three files share one geometry on a 1024 grid (1024 viewBox for the icon,
`translate(320 76) scale(0.625)` inside the 1280×720 featured viewBox; the icon
adds `translate(0 58)` so the mark sits centred on its square):

- Clapper band: rect x192 y208 w640 h104 rx28, group rotated -8° about (192 312)
- Three stripes: parallelograms (300,208 380,208 330,312 250,312), then +180
  and +360 in x, in the same rotated group
- TV body: rect x192 y344 w640 h448 rx96
- Screen: rect x256 y408 w512 h320 rx56
- Play triangle: 464,488 464,648 608,568 (optically centred in the screen)

## Rendering

Rendered with headless Chromium (Playwright), each SVG screenshotted at its
exact pixel size, device scale 1:

```
node -e "…page.setViewportSize({width:W,height:H}); page.goto('file://<svg>'); page.screenshot({clip:{x:0,y:0,width:W,height:H}})"
```

with W/H 1024×1024 for the icon and 1280×720 for the featured images. No npm
dependency was added; `rsvg-convert` (if available) does the same:
`rsvg-convert -w 1024 -h 1024 brand/icon.svg -o brand/icon.png`.

## Featured icons on Homeroom

`dapp.json` has no field for a featured icon, so `featured-light.png` and
`featured-dark.png` are committed here ready to attach by hand on Dtv's
Homeroom page in the directory.
