// Locally bundled demo imagery: no customer requests to image providers.
const descriptions: Record<string, string> = {
  notebook: 'Open notebook on a study desk',
  mug: 'White ceramic mug for the Dhaka Morning Mug demo product',
  tote: 'Natural and navy canvas tote illustrating the Everyday Jute Tote',
  headphones: 'Black wireless headphones on a yellow background',
  tea: 'Teapot and cup illustrating the Sylhet Tea Collection',
  lamp: 'Gray adjustable desk lamp for the Evening Desk Lamp demo product',
};
export function productImage(id: string) {
  return descriptions[id] ? { src: `/products/${id}.${id === 'tote' ? 'jpg' : 'webp'}`, alt: descriptions[id] } : null;
}
