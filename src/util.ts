declare const UnitSymbol: unique symbol;
export type Unit<S> = number & { [UnitSymbol]: S };

declare const SecondsSymbol: unique symbol;
declare const CustomUnixTimeStampSymbol: unique symbol;
export type Seconds = Unit<typeof SecondsSymbol>;
export type UnixTimeStamp = Unit<typeof CustomUnixTimeStampSymbol>;
