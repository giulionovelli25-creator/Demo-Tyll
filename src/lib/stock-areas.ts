// Names of the count areas, for screens. The list itself lives with the locations.
import { COUNT_LOCATIONS } from "./data/locations";
export const areaName = (id: string) => COUNT_LOCATIONS.find((l) => l.id === id)?.name ?? id;
