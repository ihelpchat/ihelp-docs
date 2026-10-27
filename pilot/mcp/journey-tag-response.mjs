// Keep the tag identity separate from the contact/tag association identity.
export function tagIdFromCreateResponse(tag, { name, realCompany = false, requestedId,
  requestContactId, expectedContactId, ownedContact = false, companyId } = {}) {
  if (typeof name !== 'string' || !name.length) return null;
  if (tag?.nome === name || tag?.tagName === name) return tag.id;
  // POST /tags?contactId returns ContactsTag: `id` belongs to the link.
  if (!realCompany || ownedContact !== true || requestedId != null && requestedId !== 0
    || !Number.isSafeInteger(expectedContactId) || expectedContactId <= 0
    || Number(requestContactId) !== expectedContactId || tag?.contatoId !== expectedContactId
    || typeof companyId !== 'string' || !companyId.length || String(tag?.empresaId ?? '') !== companyId
    || !Number.isSafeInteger(tag?.tagsId) || tag.tagsId <= 0) return null;
  return tag.tagsId;
}
