import { UnsupportedPreview } from './lifecycle.js';

// These profiles describe the actual skin signatures in the indexed 4.2 source,
// not filesystem locations. They preserve source skins and use Skin.addSkin to
// activate required bones. Alternative injuries/equipment never all merge.
export function componentSkinProfile(data) {
  if (!data.bones.some(bone => bone.skinRequired)) return null;
  const names = new Set(data.skins.map(skin => skin.name));
  const groups = [];
  const add = (id, name, choices, selected = choices[0], optional = false) => {
    const available = choices.filter(value => names.has(value));
    if (!available.length) return;
    const options = available.map(value => ({ value, name: value, skins: [value] }));
    if (optional) options.unshift({ value: '', name: '无', skins: [] });
    groups.push({ id, name, options, selected: optional && selected === '' ? '' : available.includes(selected) ? selected : available[0] });
  };
  const toggle = (id, name, value, enabled = true) => add(id, name, [value], enabled ? value : '', true);
  const has = value => names.has(value);

  if (has('Zomboni_Undamaged') && has('Zomboni_Wheels')) {
    add('body', '车身', ['Zomboni_Undamaged','Zomboni_Damage1','Zomboni_Damage2']);
    add('wheels', '轮胎', ['Zomboni_Wheels','Zomboni_Wheels_Flat']);
    add('headwear', '头饰', ['Zomboni_Beanie','Zomboni_Mullet']);
  } else if (has('Peashooter') && has('Repeater')) {
    add('variant', '角色外观', ['Peashooter','Repeater']);
  } else if (has('Kernel') && has('Butter')) {
    add('projectile', '投掷物', ['Kernel','Butter','Hidden']);
  } else if (has('Zombie_Gargantuar_Body1')) {
    add('body', '身体', ['Zombie_Gargantuar_Body1','Zombie_Gargantuar_Body1_2','Zombie_Gargantuar_Body1_3']);
    add('head', '头部', ['Zombie_Gargantuar_Head','Zombie_Gargantuar_Head_Injured','Zombie_Gargantuar_Head_Redeye','Zombie_Gargantuar_Head_Redeye_Injured']);
    add('outerarm', '外侧手臂', ['Zombie_Gargantuar_Outerarm_Uninjured','Zombie_Gargantuar_Outerarm_Injured']);
    add('outerfoot', '外侧脚部', ['Zombie_Gargantuar_Outerfoot_Uninjured','Zombie_Gargantuar_Outerfoot_Injured']);
    add('held', '手持物', ['Zombie_Gargantuar_Pole','Zombie_Gargantuar_Zombie','Zombie_Gargantuar_Duckxing']);
    toggle('imp', '背部小鬼', 'Zombie_Gargantuar_Imp');
  } else if (has('Zombie_Target_01')) {
    add('target', '目标牌', ['Zombie_Target_01','Zombie_Target_02','Zombie_Target_03','Zombie_Target_04']);
    for (const [id,label,suffix] of [['head','头部','Head'],['innerarm','内侧手臂','Innerarm'],['innerhand','内侧手','Innerhand'],['outerarm-lower','外侧前臂','Outerarm_Lower'],['outerarm-upper','外侧上臂','Outerarm_Upper'],['outerhand','外侧手','Outerhand']]) toggle(id,label,`Zombie_Target_${suffix}`);
  } else if (has('Zombie_Digger_Head')) {
    toggle('head', '头部', 'Zombie_Digger_Head');
    add('arm', '手臂', ['Zombie_Digger_Uninjured','Zombie_Digger_Injured']);
    add('helmet', '安全帽', ['Zombie_Digger_HardHat','Zombie_Digger_HardHat2','Zombie_Digger_HardHat3']);
    toggle('pickaxe', '镐', 'Zombie_Digger_Pickaxe');
  } else if (has('Zombie_Disco_Head')) {
    toggle('head', '头部', 'Zombie_Disco_Head');
    add('body', '身体', ['Zombie_Disco_Uninjured','Zombie_Disco_Injured']);
  } else if (has('Zombie_Bobsled_Head')) {
    toggle('head', '头部', 'Zombie_Bobsled_Head');
    add('body', '身体', ['Zombie_Bobsled_Uninjured','Zombie_Bobsled_Injured']);
  } else if (has('Zombie_Imp_Uninjured')) {
    add('head', '头部', ['Zombie_Imp_Head','Zombie_Imp_Head_Hidden']);
    add('body', '身体', ['Zombie_Imp_Uninjured','Zombie_Imp_Injured']);
  } else if (has('Zombie_Pogo_Undamaged')) {
    add('pogo', '弹跳杆', ['Zombie_Pogo_Undamaged','Zombie_Pogo_Damage1','Zombie_Pogo_Damage2']);
    toggle('head', '头部', 'Zombie_Pogo_Head');
    add('body', '身体', ['Zombie_Pogo_Uninjured','Zombie_Injured']);
    add('hand', '持杆手', ['Zombie_Pogo_Uninjured_PogoHand','Zombie_Pogo_Injured_PogoHand']);
  } else if (has('Yeti_Uninjured')) {
    toggle('head', '头部', 'Yeti_Head');
    add('body', '身体', ['Yeti_Uninjured','Yeti_Injured']);
  } else if (has('FrontArm') || has('BackArm') || has('Head')) {
    add('frontarm', '前臂', ['FrontArm','FrontArm_Injured','FrontArm_Hidden']);
    add('backarm', '后臂', ['BackArm','BackArm_Injured','BackArm_Hidden']);
    add('head', '头部', ['Head','Head_Grossout','Head_Hidden','Head_Sunglasses1','Head_Sunglasses2','Head_Sunglasses3','Head_Sunglasses4']);
    add('headgear', '头部装备', ['zombie_football_helmet','zombie_football_helmet_2','zombie_football_helmet_3','bucket','bucket2','bucket3','cone','cone2','cone3'], has('zombie_football_helmet') ? 'zombie_football_helmet' : '', !has('zombie_football_helmet'));
    add('ladder', '梯子', ['Ladder_Default','Ladder_Damaged1','Ladder_Damaged2','Ladder_Glow','Ladder_Damaged1_Glow','Ladder_Damaged2_Glow']);
    toggle('jackbox', '玩偶盒', 'Jackbox');
    add('flag', '旗帜', ['flag_default','flag_destroyed'], '', true);
    add('moustache', '胡须', ['moustache','moustache2','moustache3'], '', true);
    add('held', '手持装备', ['screenDoor','screenDoor2','screenDoor3','screenDoor_Hidden','trashcan1','trashcan2','trashcan3'], '', true);
    toggle('duckytube', '泳圈', 'duckytube', false);
    toggle('swimming', '游泳组件', 'swimming', false);
    toggle('tongue', '舌头', 'Tongue', false);
  } else if (has('Zombie_Gargantuar_Imp')) {
    toggle('imp', '背部小鬼', 'Zombie_Gargantuar_Imp');
  }

  if (!groups.length) throw new UnsupportedPreview('此骨骼包含需组合的组件皮肤，当前没有已核的完整预览配置');
  const represented = new Set(groups.flatMap(group => group.options.flatMap(option => option.skins)));
  const unknown = [...names].filter(name => name !== data.defaultSkin?.name && !represented.has(name));
  if (unknown.length) throw new UnsupportedPreview(`组件皮肤配置未覆盖：${unknown.join('、')}`);
  return groups;
}

export function createSkinSelection(S, data) {
  const definitions = componentSkinProfile(data);
  const defaults = new Map(definitions?.map(group => [group.id, group.selected]) || []);
  let values = new Map(defaults);
  const build = selected => {
    const skin = new S.Skin('preview-components');
    if (data.defaultSkin) skin.addSkin(data.defaultSkin);
    for (const group of definitions || []) {
      const option = group.options.find(option => option.value === selected.get(group.id));
      for (const name of option?.skins || []) skin.addSkin(data.findSkin(name));
    }
    return skin;
  };
  return {
    component: !!definitions,
    get groups() { return (definitions || []).map(group => ({ id:group.id, name:group.name, options:group.options.map(option => ({value:option.value,name:option.name})), selected:values.get(group.id) })); },
    get skin() { return definitions ? build(values) : null; },
    previewGroup(id, value) {
      const group = definitions?.find(group => group.id === id);
      if (!group?.options.some(option => option.value === value)) return null;
      const next = new Map(values); next.set(id,value); return { values:next, skin:build(next) };
    },
    previewSkin(name) {
      if (!definitions) return null;
      if (name === data.defaultSkin?.name) return {values:new Map(defaults),skin:build(defaults)};
      const group = definitions.find(group => group.options.some(option => option.value === name));
      return group ? this.previewGroup(group.id,name) : null;
    },
    commit(candidate) { values = candidate.values; },
  };
}
