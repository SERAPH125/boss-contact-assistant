// Boss 会话稳定主键：以好友列表 encryptUid 为 canonical peerId（零 DOM 纯函数）。
(function (g, factory) {
  var api = factory();
  g.BossPeerIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  // 开源实测 encryptUid/bossId 可含 '~'（如 ...GA~~）
  var PEER_ID_RE = /^[A-Za-z0-9_~-]{1,128}$/;
  var MAX_ALIASES = 8;
  var FRIEND_ID_KEYS = [
    'encryptUid',
    'uid',
    'bossId',
    'encryptBossId',
    'encryptFriendId',
    'conversationId',
    'friendId'
  ];

  function isPeerId(value) {
    return typeof value === 'string' && PEER_ID_RE.test(value);
  }

  function asPeerId(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
      value = String(value);
    }
    return isPeerId(value) ? value : '';
  }

  function uniqueIds(values) {
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var id = asPeerId(value);
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function normalizeAliases(values, peerId) {
    return uniqueIds(values).filter(function (id) {
      return id !== peerId;
    }).slice(0, MAX_ALIASES);
  }

  function canonicalChatUrl(origin, peerId) {
    if (!isPeerId(peerId) || typeof origin !== 'string') return '';
    try {
      var base = new URL(origin);
      if (base.protocol !== 'https:' ||
        base.username ||
        base.password ||
        base.port ||
        base.hostname === 'zhipin.com' ||
        !base.hostname.endsWith('.zhipin.com')) {
        return '';
      }
      // 直接拼接：searchParams.set 会把 '~' 编成 %7E，与 Boss/开源实测明文 uid 不一致
      return base.origin + '/web/geek/chat?uid=' + peerId;
    } catch (_) {
      return '';
    }
  }

  function friendIdentityValues(friend) {
    if (!friend || typeof friend !== 'object' || Array.isArray(friend)) return [];
    var out = [];
    FRIEND_ID_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(friend, key)) return;
      var id = asPeerId(friend[key]);
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function sanitizeFriend(friend) {
    if (!friend || typeof friend !== 'object' || Array.isArray(friend)) return null;
    var ids = friendIdentityValues(friend);
    if (!ids.length) return null;
    var encryptUid = asPeerId(friend.encryptUid);
    return {
      encryptUid: encryptUid,
      ids: ids,
      name: typeof friend.name === 'string' ? friend.name.slice(0, 80) : '',
      company: typeof friend.brandName === 'string'
        ? friend.brandName.slice(0, 80)
        : (typeof friend.company === 'string' ? friend.company.slice(0, 80) : '')
    };
  }

  function sanitizeFriendList(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.slice(0, 200).forEach(function (item) {
      var friend = sanitizeFriend(item);
      if (friend) out.push(friend);
    });
    return out;
  }

  function resolvePeerIdentity(input) {
    var source = input && typeof input === 'object' ? input : {};
    var domIds = uniqueIds(source.domIds);
    var friends = sanitizeFriendList(source.friends);
    var origin = typeof source.origin === 'string' ? source.origin : '';
    if (!domIds.length) {
      return { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    }
    if (!friends.length) {
      return { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    }

    var matched = [];
    friends.forEach(function (friend) {
      var hit = friend.ids.some(function (id) {
        return domIds.indexOf(id) !== -1;
      });
      if (hit) matched.push(friend);
    });
    if (matched.length !== 1) {
      return { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    }

    var friend = matched[0];
    var peerId = friend.encryptUid || friend.ids[0];
    if (!isPeerId(peerId)) {
      return { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    }
    var url = canonicalChatUrl(origin, peerId);
    if (!url) {
      return { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    }
    var aliases = normalizeAliases(domIds.concat(friend.ids), peerId);
    return {
      ok: true,
      peerId: peerId,
      openParam: 'uid',
      url: url,
      aliases: aliases,
      peerSource: 'encryptUid',
      matchedName: friend.name,
      matchedCompany: friend.company
    };
  }

  function managedIdentitySet(conversation) {
    var source = conversation && typeof conversation === 'object' ? conversation : {};
    var ids = [source.conversationId];
    if (Array.isArray(source.aliases)) ids = ids.concat(source.aliases);
    return uniqueIds(ids);
  }

  function matchesManagedIdentity(activeId, conversation) {
    var id = asPeerId(activeId);
    if (!id) return false;
    return managedIdentitySet(conversation).indexOf(id) !== -1;
  }

  function toCanonicalRef(peerId, origin, aliases) {
    if (!isPeerId(peerId)) return null;
    var url = canonicalChatUrl(origin || 'https://www.zhipin.com', peerId);
    if (!url) return null;
    return {
      conversationId: peerId,
      url: url,
      aliases: normalizeAliases(aliases, peerId)
    };
  }

  return {
    PEER_ID_RE: PEER_ID_RE,
    MAX_ALIASES: MAX_ALIASES,
    isPeerId: isPeerId,
    uniqueIds: uniqueIds,
    normalizeAliases: normalizeAliases,
    canonicalChatUrl: canonicalChatUrl,
    sanitizeFriendList: sanitizeFriendList,
    resolvePeerIdentity: resolvePeerIdentity,
    matchesManagedIdentity: matchesManagedIdentity,
    managedIdentitySet: managedIdentitySet,
    toCanonicalRef: toCanonicalRef
  };
});
