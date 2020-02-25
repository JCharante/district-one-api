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
    sessionKeyIsValid: async function(sessionKey_string) {
        if (sessionKey_string.length !== 12 && sessionKey_string.length !== 24) {
            return false;
        }
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const sessionsCollection = db.collection('sessions');
        const ret = await sessionsCollection.findOne({ _id: ObjectId(sessionKey_string) });
        await client.close();
        if (ret) {
            return { valid: true, dialCode: ret.dialCode, phoneNumber: ret.phoneNumber }
        } else {
            return { valid: false }
        }
    },
    dailyLoginReward: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const usersCollection = db.collection('users');
        const ret = await usersCollection.findOne({ dialCode, phoneNumber });
        if (!ret) {
            await client.close();
            return { gaveReward: false };
        }
        let shouldGiveReward = false;
        let lastLoginRewardTime = ret.lastLoginRewardTime;
        if (lastLoginRewardTime === undefined) {
            shouldGiveReward = true;
        } else {
            // calculate if it's been six hours
            lastLoginRewardTime.setHours(lastLoginRewardTime.getHours() + 6);
            if (new Date() > lastLoginRewardTime) {
                shouldGiveReward = true;
            }
        }
        if (shouldGiveReward) {
            await usersCollection.updateOne({ dialCode, phoneNumber }, { '$set': { lastLoginRewardTime: new Date() }, '$inc': { balance: 5 } });
        }
        await client.close();
        return { gaveReward: shouldGiveReward }
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
    likeTeam: async function(dialCode, phoneNumber, teamNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        let ret = await teamLikesCollection.findOne({ dialCode, phoneNumber, teamNumber });
        if (ret === null) {
            ret = await teamLikesCollection.insertOne({ dialCode, phoneNumber, teamNumber });
        }
        await client.close();
        return;
    },
    unlikeTeam: async function(dialCode, phoneNumber, teamNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        let ret = await teamLikesCollection.deleteOne({ dialCode, phoneNumber, teamNumber });
        await client.close();
        return;
    },
    getTeamAndEventLikes: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        let teamLikes = (await teamLikesCollection
            .find({ dialCode, phoneNumber })
            .toArray())
            .map((document) => { return document.teamNumber });
        let eventLikes = [];
        await client.close();
        return { teamLikes, eventLikes };
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
        if (referrerCode === undefined) {
            referrerCode = '';
        }
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
    },
    getAvatarsForTeams: async function(list_of_team_number) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamsCollection = db.collection('teams');
        const teams = await teamsCollection.find({ team_number: { '$in': list_of_team_number }}).toArray();
        const ret = {}
        teams.forEach((teamDoc) => {
            if ('avatar' in teamDoc) {
                ret[teamDoc.team_number] = teamDoc.avatar;
            }
        })
        await client.close();
        return ret;
    },
    getTeamsForTeamList: async function() {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamsCollection = db.collection('teams');
        const ret = await teamsCollection.aggregate([
            {
                '$lookup': {
                    'from': 'teamLikes',
                    'localField': 'team_number',
                    'foreignField': 'teamNumber',
                    'as': 'likedBy'
                }
            }, {
                '$group': {
                    '_id': null,
                    'teams': {
                        '$push': {
                            'likes': {
                                '$size': '$likedBy'
                            },
                            'team_number': '$team_number',
                            'nickname': '$nickname'
                        }
                    }
                }
            }
        ]).toArray();
        await client.close();
        return ret[0].teams;
        
    },
}
