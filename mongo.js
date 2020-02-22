const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectID;
const atlasURL = process.env.ATLAS_URL;

async function getConnectedClient() {
    const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
    await client.connect();
    return client;
}

function randomStr(len, arr) {
    let ans = '';
    for (var i = len; i > 0; i--) {
        ans +=
            arr[Math.floor(Math.random() * arr.length)];
    }
    return ans;
}

module.exports = {
    getUserFromSessionKey: async function(sessionKey) {
        const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('your-final-grade');
        const sessionsCollection = db.collection('sessions');
        
        const sessionDocument = await sessionsCollection.findOne({ _id: ObjectId(sessionKey) });
        if (!sessionDocument) {
            throw new Error('Invalid Session Key');
        }
        
        const usersCollection = db.collection('users');
        const userDocument = await usersCollection.findOne({ _id: sessionDocument.user });
        if (!userDocument) {
            throw new Error('User Does Not Exist');
        }
        await client.close();
        return userDocument;
    },
    createSession: async function(dialCode, phoneNumber, ip) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const sessionsCollection = db.collection('sessions');
        const expiresAt = new Date(new Date().getTime() + (14 * 24 * 3600 * 1000));
        const ret = await sessionsCollection.insertOne({ ip, dialCode, phoneNumber, expiresAt })
        await client.close();
        console.log("Created session for ", dialCode, phoneNumber, "from ", ip);
        return { sessionKey: ret.insertedId.toString() };
    },
    authAbuseIsDetected: async function(ip, dialCode, phoneNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const col = db.collection('authRequests');
        const fiveMinutesAgo = new Date();
        fiveMinutesAgo.setMinutes(new Date().getMinutes() - 5);
        const requestsFromIP = await col.find({
            time: {
                '$gte': fiveMinutesAgo,
            },
            ip
        }).toArray();
        const requestsForNumber = await col.find({
            dialCode,
            phoneNumber,
            time: {
                '$gte': fiveMinutesAgo,
            },
        }).toArray();
        console.log('Requests from IP: ', ip, requestsFromIP.length, ' Requests for Phone +', dialCode, phoneNumber, requestsForNumber.length);
        return requestsFromIP.length > 4 || requestsForNumber.length > 3;
    },
    logSendSMS: async function(ip, dialCode, phoneNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const col = db.collection('authRequests');
        const time = new Date();
        const ret = await col.insertOne({
            ip,
            dialCode,
            phoneNumber,
            time
        });
        await client.close();
        return;
    },
    doesUserExist: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        const ret = await col.findOne({ dialCode, phoneNumber });
        await client.close();
        return !!ret;
    },
    isReferralCodeUnique: async function(code) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        const ret = await col.findOne({ referralCode: code });
        await client.close();
        return !ret;
    },
    createUser: async function(dialCode, phoneNumber, referrerCode) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        // generate a six-digit referrer code for them
        let referralCode = '';
        while (referralCode.length === 0 || !this.isReferralCodeUnique(referralCode)) {
            referralCode = randomStr(6, ['a', 'e', 'i', 'o', 'u', 'y', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        }
        // insert into DB
        const ret = await col.insertOne({ dialCode, phoneNumber, referrerCode, referralCode });
        console.log("Created account for ", dialCode, phoneNumber, "referred by", referrerCode, "given referral code", referralCode);
        // find who referred them if anyone
        if (referrerCode.length > 0) {
            const referrer = await col.findOne({ referralCode: referrerCode });
            if (referrer) {
                // give them points for the referral
                await col.updateMany({ referralCode: { '$in': [referrerCode, referralCode] } }, { '$inc': { balance: 5 } });
                console.log("Credited users for the referral");
            }
        }
        await client.close();
    },
    setUserDataStore: async function(userObjectId, newDataStore) {
        const client = await getConnectedClient();
        const db = client.db('your-final-grade');
        const usersCollection = db.collection('users');
        await usersCollection.updateOne(
            {
                _id: userObjectId,
            },
            {
                '$set': {
                    dataStore: newDataStore
                }
            }
        )
        await client.close();
    }
}
