export interface RealtimeVisitorLocation {
  latitude: number
  longitude: number
  count: number
}

export interface RealtimeVisitorsPayload {
  count: number
  locations: Array<RealtimeVisitorLocation>
}
