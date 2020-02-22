'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const MongoClient = require('mongodb').MongoClient;
require('dotenv').config();
const atlasUrl = process.env.ATLAS_URL;

const mongoHandler = require('./mongo');

const app = express();
const twilio = require('twilio');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_KEY)

app.use(bodyParser.json());

exports.handler = (event, context, callback) => {
    handleRequest(event, context, callback);
};

async function handleRequest(req, res, spare) {
    res.set({
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }
    let body = req.body;
    console.log('Received request %o', body);
    
    let requestType = ""
    requestType = body.requestType || requestType;
    let userDoc;
    
    // enforce a session key for non-login, non-signup, or non-ping requests
    if (requestType !== "ping" && requestType !== "sendSMS" && requestType !== "checkCode") {
        const sessionKey = body.sessionKey;
        if (!sessionKey) {
            res.status(403).send('You must include a session key in your request');
            return;
        }
        // there is a session key
        // get user for session key
        try {
            userDoc = await mongoHandler.getUserFromSessionKey(sessionKey);
        } catch (err) {
            res.status(400).send(err.toString())
            return
        }
    }
    
    try {
        const username = body.username;
        const password = body.password;
        const ip = req.headers['x-appengine-user-ip'] || req.header['x-forwarded-for'] || req.connection.remoteAddress;
        let ret;
        let sessionKey = null;
        const dialCode = body.dialCode;
        const phoneNumber = body.phoneNumber;
        switch (requestType) {
        case 'ping':
            res.status(200).send('pong');
            break;
        case 'sendSMS':
            if (!dialCode || !phoneNumber) {
                throw Error("Not all fields filled");
            }
            // Anti-Spam Measures
            if (await mongoHandler.authAbuseIsDetected(ip, dialCode, phoneNumber)) {
                res.status(420).send(JSON.stringify({ error: 'Rate limit', message: 'You are sending too many requests' }))
                return;
            }
            twilioClient.verify.services(process.env.VERIFY_ID)
                .verifications
                .create({ to: `+${dialCode}${phoneNumber}`, channel: 'sms' })
                .then(verification => console.log(verification.status));
            // Log event
            await mongoHandler.logSendSMS(
                ip,
                dialCode,
                phoneNumber
            );
            res.status(200).send();
            break;
        case 'checkCode':
            const code = body.code;
            if (!code || !dialCode || !phoneNumber) {
                throw Error ("missing verification code");
            }
            try {
                const verificationCheck = await twilioClient.verify.services(process.env.VERIFY_ID)
                    .verificationChecks
                    .create({
                        to: `+${dialCode}${phoneNumber}`,
                        code });
                console.log(verificationCheck);
                if (verificationCheck.status === 'approved') {
                } else {
                    res.status(400).send();
                    return;
                }
            } catch (error) {
                console.log(error);
                if (error.status === 404) {
                    // that code expired
                    res.status(404).send();
                }
                return;
            }
            console.log('done now can do other things');
            const referrerCode = body.referrerCode;
            // This is to check who referred the user, gives points
            // Check if user account exists
            const userExists = await mongoHandler.doesUserExist(dialCode, phoneNumber);
            console.log(userExists);
            // If user account doesn't exist, create user account and pass referrer Code
            if (!userExists) {
                await mongoHandler.createUser(dialCode, phoneNumber, referrerCode);
            }
            // create a session;
            const { sessionKey } = await mongoHandler.createSession(dialCode, phoneNumber, ip);
            res.status(200).send(sessionKey);
            break;
        default:
            res.status(400).send(`Unsupported requestType "${requestType}"`);
        }
    } catch (error) {
        console.error('Error while handling request: %o', error);
        res.status(500).send(`Error while handling request: ${error}`);
    }
}

app.post('/', handleRequest);
app.options('/', handleRequest);

app.listen(3001)
