# Cafe simulation — proposed MVP visual reference

Status: proposed direction, awaiting user feedback before implementation. No game has been implemented yet.

Primary reference: `cafe-mvp-reference-v1.png`, generated with the built-in image generation tool. See `mockup-prompt.txt` for the exact generation prompt.

## Visual target

Reproduce the reference's overall composition and visual hierarchy in real-time Three.js. It is an art-direction reference, not a guarantee of pixel-identical rendering.

- Fixed orthographic isometric camera: start at 45° azimuth and 35.264° elevation; fit the entire room between the HUD and toolbar. Allow bounded zoom; defer rotation.
- One rectangular floor slab, two rear walls, open front edges and no roof. Entrance at the near-right edge.
- Wooden service counter on the rear-left side, preparation area behind it, clear customer queue in front, three square tables with two chairs each in the foreground/right seating area.
- Chunky low-poly geometry, simple articulated characters, matte materials, soft directional shadows and warm ambient illumination.
- Suggested palette, approximated from the reference: background #F5F0E7, cream walls #DECCB3, honey wood #B7834D, sage #697955, terracotta #B76D49, dark coffee #493426.
- Cream rounded UI panels, dark brown sans-serif text, subtle tan borders, sage primary control. Day top left; cash, served count and waiting count top right; open/close, pause and speed controls bottom center.
- Use one consistent furniture and character scale. Keep walkways visibly clear and avoid UI covering customers or tables.

## Proposed playable MVP

One room, three tables, one barista, one coffee recipe, and a small capped customer population. Customers enter, queue, order, wait for preparation, collect coffee, sit when a chair is available, then leave. Customers unable to sit can take their drink away. Track cash, served count, waiting count and day progress. Opening/closing, pause and speed controls provide the initial player interaction; balancing and a simple upgrade can follow once this loop is validated.

Defer room expansion, furniture placement, hiring, inventory supply chains, multiple recipes, complex animations and elaborate decorations. Menu text, pastry display and additional props in the generated image are decorative references, not commitments to additional systems. The shown currency is provisional.

## Development reference workflow

1. Read this brief and inspect the PNG before building the scene.
2. Block out camera, floor, walls, counter and tables first. Capture the actual game at a matching landscape aspect ratio and compare composition before adding details.
3. Match palette, object scale, lighting and UI placement; then add characters and the simulation loop.
4. Compare another screenshot after visual changes. Evaluate camera/framing, layout, silhouette, colors, shadows and UI independently. Make deliberate adjustments rather than silently changing the art direction.
5. Check a narrower viewport for clipped UI and obstructed gameplay. Keep the reference and brief updated only when the user agrees to a new direction.

Generated reference details such as tiny countertop objects, wood seams and cinematic shadow softness may be simplified for clarity and performance. Preserve the recognizable scene composition first.
