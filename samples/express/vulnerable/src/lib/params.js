function toId(value) {
  const id = Number.parseInt(value, 10)
  return Number.isInteger(id) && id > 0 && String(id) === String(value) ? id : null
}

module.exports = { toId }
