var forge = require("node-forge");
var CryptoKey = require("../CryptoKey.js")

var subtleToForge = {
  hash:{
    "SHA-256" : "sha256",
    "SHA-1": "sha1"
  }
}
var makeUsage = {
  encrypt: function makeEncrypt(key){
    return function RSA_OAEP_ENCRYPT(alg,buf){
      return new Buffer(key.encrypt(buf.toString("binary"), "RSA-OAEP"),"binary");
    };
  },
  decrypt : function makeDecrypt(key){
    return function RSA_OAEP_DECRYPT(alg,buf){
      return new Buffer(key.decrypt(buf.toString("binary"), "RSA-OAEP"),"binary");
    }
  }
}
var pkcsPad1  = new Buffer([48, 130])
var pkcsPad2  = new Buffer([2, 1, 0, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0, 4, 130])

function rawToPKCS8(secret){
  var off1 = new Buffer([Math.floor(secret.length / 256),((secret.length + 22) % 256) ])
  var off2 = new Buffer([Math.floor(secret.length / 256), (secret.length % 256)])
  return Buffer.concat([pkcsPad1, off1, pkcsPad2, off2, secret]);
}

function PKCS8ToRaw(secret){
  return secret.slice(pkcsPad1.length + pkcsPad2.length + 4);
}

var Export = {
  "public": {
    "spki" : function(publicKey){
      return forge.asn1.toDer(forge.pki.publicKeyToAsn1(publicKey)).bytes()
    }
  },
  "private":{
    "pkcs8": function(privateKey){
      var secret = new Buffer(forge.asn1.toDer(forge.pki.privateKeyToAsn1(privateKey)).bytes(), "binary");
      console.log("SECRET", secret)
      return rawToPKCS8(secret);
    }
  }
};

var Import = {
  "pkcs8" : function(keybuf){
    var secret = PKCS8ToRaw(keybuf);
    return forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(secret.toString("binary")));

  },
  "spki" : function(keybuf){
    return forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(keybuf.toString("binary")))
  }
}

var makeExporter = function makeExporter(type, key){
  return function exportKey(format){
    return (Export[type][format]) ? Export[type][format](key)
                                  : new Error("unsupported export format");
  }
};

function createCryptoKey(key, type, exportable, usage, nonce){
  var uses = {}, exporter;
  if (usage)
    uses[usage] = makeUsage[usage](key);
  if (exportable)
    exporter = makeExporter(type,key);

  console.log("OAEP KEY")
  return new CryptoKey(key, type, exporter, uses, nonce)
}

function createCryptoKeyPair(keys, exportable, usages, nonce){
  var publicUse  = (usages.indexOf("encrypt") >= 0) ? "encrypt"
                                                    : null;
  var privateUse = (usages.indexOf("decrypt") >= 0) ? "decrypt"
                                                    : null;
  var public  = createCryptoKey(keys.publicKey, "public", exportable, publicUse, nonce);
  var private = createCryptoKey(keys.privateKey, "private", exportable, privateUse, nonce);

  return Promise.resolve({
    publicKey : public,
    privateKey : private
  });
}

function checkAlgorithmAndUsage(algorithm, usages){
  var forgehashKey = subtleToForge.hash[algorithm.hash.name];
  console.log(forgehashKey)
  if (!(algorithm.hash && forge.md[forgehashKey]))
    return new Error("unsupported or invalid hash name")
  else {
    for (var i in usages)
      if ((["encrypt","decrypt"]).indexOf(usages[i]) < 0)
        return new Error("cannot make a key with usage: " + usages[i])
  }
  return false;
}

function makeKeyPair(algorithm){
  var exp = 0, pos = 0
  for (var i = algorithm.publicExponent.length - 1 ; i >= 0 ; i--){
    exp += algorithm.publicExponent[i] << (pos * 8);
    pos++;
  }

  return forge.rsa.generateKeyPair({bits: algorithm.modulousLength , e: exp});
}


function generateKey(algorithm, exportable, usages, nonce){
  var err = checkAlgorithmAndUsage(algorithm, usages)
  if (err){
    return Promise.reject(err)
  } else {
    keys = makeKeyPair(algorithm)
    console.log("made keypair")
    return createCryptoKeyPair(keys, exportable, usages, nonce);
  }
}

function importKey(format, key, algorithm, exportable, usages, nonce){
  console.log("OAEP import")
  var err = checkAlgorithmAndUsage(algorithm, usages)
  if (err){
    console.log("OAEP alg or usage problem")
    throw err;
  } else if (!Import[format]){
    throw new Error("unsupported import format");
  } else {
    key = Import[format](key)
    var type = (format === "spki") ? "public" : "private";
    var usage = (type === "public") ? "encrypt" : "decrypt";
    for (var i in usages)
      if (usages[i] != usage)
        throw new Error("cannot import a key with the provided uses");

    console.log("all good")
    return createCryptoKey(key, type, exportable, usage, nonce);
  }
}

module.exports = {
  generateKey : generateKey,
  importKey : importKey
}