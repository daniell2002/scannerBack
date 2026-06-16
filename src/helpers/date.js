export const startOfToday = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

export const startOfTomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d
}

export const isToday = (date) => {
  const d = new Date(date), t = new Date()
  return d.getFullYear() === t.getFullYear() &&
         d.getMonth()    === t.getMonth()    &&
         d.getDate()     === t.getDate()
}
