declare module "leaflet.heat" {
  import type * as L from "leaflet";

  interface HeatLatLngTuple extends Array<number> {
    0: number;
    1: number;
    2?: number;
  }

  interface HeatMapOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface HeatLayer extends L.Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): this;
    addLatLng(latlng: HeatLatLngTuple): this;
    setOptions(options: HeatMapOptions): this;
    redraw(): this;
  }

  function heatLayer(
    latlngs: HeatLatLngTuple[],
    options?: HeatMapOptions
  ): HeatLayer;

  module "leaflet" {
    function heatLayer(
      latlngs: HeatLatLngTuple[],
      options?: HeatMapOptions
    ): HeatLayer;
  }
}
