/**
 * Sprite Loader — Phase 12 R1
 * Loads a registry of named sprites, returns a Promise that resolves
 * when ALL are decoded. Caches the resulting HTMLImageElements.
 * Failures resolve to null so the renderer can fall back to colour.
 */
'use strict';

const SPRITE_REGISTRY = {
  floor:        '/static/assets/tiles/floor_stone.png',
  floor_wood:   '/static/assets/tiles/floor_wood.png',
  floor_grass:  '/static/assets/tiles/floor_grass.png',
  wall:         '/static/assets/tiles/wall_stone.png',
  wall_wood:    '/static/assets/tiles/wall_wood.png',
  door_closed:  '/static/assets/tiles/door_closed.png',
  door_open:    '/static/assets/tiles/door_open.png',
  water:        '/static/assets/tiles/water.png',
  lava:         '/static/assets/tiles/lava.png',
  pit:          '/static/assets/tiles/pit.png',
  rough:        '/static/assets/tiles/rough.png',
};

const _sprites = {};
let _loadPromise = null;

function loadSprites() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = Promise.all(Object.entries(SPRITE_REGISTRY).map(
    ([key, url]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { _sprites[key] = img; resolve(); };
      img.onerror = () => {
        console.warn(`sprite ${key} failed to load — fallback to color`);
        _sprites[key] = null;
        resolve();
      };
      img.src = url;
    })
  ));
  return _loadPromise;
}

window.SpriteRegistry = {
  load: loadSprites,
  get: (key) => _sprites[key] || null,
  has: (key) => !!_sprites[key],
};
