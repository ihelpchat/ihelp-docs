// Keep the tag identity separate from the contact/tag association identity.
export function tagIdFromCreateResponse(tag, { name } = {}) {
  return tag?.nome === name || tag?.tagName === name ? tag.id : null;
}
