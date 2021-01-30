import crypto from 'crypto';

const job={
  help:()=>console.table(Object.keys(job)),
  // params:{} -> req.params
};
/**
 * working
 * crypto-:jobName
 * @param {any} req
 */
export default async function(req){

  var jobName = req.params.jobName;

  try {
    if (typeof job[jobName] == 'function') {
      job.params = req.params;
      return await job[jobName]() || 'Done';
    }
    return 'avaliable: '+ Object.keys(job).join(', ')
  } catch (error) {
    return error.message || error;
  }
}

job.testing = async function(req={}){
  // return crypto.randomBytes(16);
  // var dir = 'music/zola/Agape/Agape No.1/Dawimangpa.mp3';
  // var dir = 'Series/Academy.1/Van Kongpi Ih Tun Ciang.mp3';
  var dir = 'MPROL/MYC နှစ်(၃၀)ပြည့်/10.mp3';
  // var dir = 'music/myanmar/MPROL';
  var dirEncrypt = encrypt(dir);
  var dirDecrypt = decrypt(dirEncrypt);
  console.log(dirEncrypt,dirDecrypt)
};

// 'aes-256-cbc aes-256-ctr'
// 'aes-256-cbc',
// 'aes-256-cbc-hmac-sha1',
// 'aes-256-cfb',
// 'aes-256-cfb1',
// 'aes-256-cfb8',
// 'aes-256-ctr',
// 'aes-256-ecb',
// 'aes-256-gcm',
// 'aes-256-ofb',
// 'aes-256-xts',

const algorithm = 'aes-256-ctr';
// const password = 'test';
const secret = 'iQVJ7sdmpNWj89IqSc7rdxs01lwKzjb6';
// const iv = crypto.randomBytes(16);
const iv =  Buffer.from('Cc7rdxs01lwHzfr3')

function sha1(input) {
  // crypto.createHmac('md5', secret).update(input).digest('hex');
  return crypto.createHash('sha1',secret).update(input).digest();
}

function encrypt(str) {
  var cipher = crypto.createCipheriv(algorithm, secret,iv);
  return Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]).toString('hex');
}

function decrypt(str) {
  var cipher = crypto.createDecipheriv(algorithm, secret, iv);
  // var decrypted = cipher.update(str, 'hex', 'utf8');
  // var tag = cipher.getAuthTag();
  // decrypted += cipher.final();
  return cipher.update(str, 'hex', 'utf8') + cipher.final();
}
