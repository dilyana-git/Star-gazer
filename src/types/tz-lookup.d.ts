/**
 * tz-lookup ships no types. Its whole surface is one function: latitude and
 * longitude in, IANA zone name out. It throws for a few unmapped coordinates,
 * which `timezoneFor` in the store catches.
 */
declare module 'tz-lookup' {
  export default function tzlookup(latitude: number, longitude: number): string;
}
