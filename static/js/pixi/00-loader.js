'use strict';
window.PixiAtlas = (() => {
  let _sheet = null;
  async function load() {
    if (_sheet) return _sheet;
    _sheet = await PIXI.Assets.load('/static/assets/atlas/world.json');
    return _sheet;
  }
  function tex(name) {
    if (!_sheet) throw new Error('PixiAtlas.load() not awaited yet');
    const t = _sheet.textures[name];
    if (!t) console.warn(`atlas miss: ${name}`);
    return t || PIXI.Texture.WHITE;
  }
  return { load, tex };
})();
