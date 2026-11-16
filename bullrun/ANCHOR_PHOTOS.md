# Realistic AI anchors

BullRun ships with illustrated anchors. To show realistic, photo-style presenters instead, drop one image per channel into `public/img/anchors/` and restart the server:

| File | Anchor | Channel |
|---|---|---|
| `flashwire.png` | Jax Rourke, lead anchor | Flashwire |
| `marketline.png` | Meera Kapoor, markets editor | Marketline |
| `undercurrent.png` | Nadia Voss, investigations | The Undercurrent |
| `dailypulse.png` | Sunny and Tara, co-hosts (one image with both people) | Daily Pulse |

`.png`, `.jpg`, `.jpeg` or `.webp` all work. Use a portrait image, roughly 3:4, head and shoulders, face in the upper half, plain studio background. In the studio a button "Anchors: realistic / illustrated" switches between the two looks, and a small "AI-generated anchor" tag is always shown on photo anchors.

Please use only fictional, AI-generated people (or people who have given permission). Do not use the face of a real person who has not agreed to it.

## Prompts you can paste into an image generator

Add "photorealistic, 85mm, soft studio light, neutral dark backdrop, looking at camera, waist-up, no text, no logos" to each.

- **Jax Rourke (Flashwire):** a fictional South Asian man in his early 30s, sharp haircut, charcoal suit, red tie, confident energetic expression, news anchor.
- **Meera Kapoor (Marketline):** a fictional Indian woman in her late 30s, shoulder-length dark hair, rectangular glasses, navy blazer, calm authoritative expression.
- **Nadia Voss (Undercurrent):** a fictional woman in her early 40s, short dark bob, deep purple jacket, serious investigative-journalist expression.
- **Sunny and Tara (Daily Pulse):** two fictional co-hosts, a smiling man and a smiling woman in warm yellow and white clothing, morning-show energy, seated side by side.

Photo anchors get a gentle talking motion while they speak. Real lip-sync needs a video model; if you later add one, replace the `<img>` in `figure()` in `public/js/anchors.js` with a looping video.
