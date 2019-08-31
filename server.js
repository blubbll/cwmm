// server.js
// where your node app starts

// init project
const express = require('express');
const app = express();
const fetch = require("node-fetch")
const request = require("request")
const fs = require("fs")
const LocalStorage = require("node-localstorage").LocalStorage;

//ls
if (typeof localStorage === "undefined" || localStorage === null) {
    localStorage = new LocalStorage('./scratch');
}

//create required directories
["./tmp"].forEach(async dir => {
    fs.existsSync(dir) || fs.mkdirSync(dir);
});

const getDate = () => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
};

const quota = {
    set: (c) => {
        localStorage.setItem(`dls_${getDate()}`, c);
    },
    get: () => {
        return localStorage.getItem(`dls_${getDate()}`)
    },
    add: () => {
        let c = localStorage.getItem(`dls_${getDate()}`);
        localStorage.setItem(`dls_${getDate()}`, (+c) + 1);
    },
    substract: () => {
        let c = localStorage.getItem(`dls_${getDate()}`);
        localStorage.setItem(`dls_${getDate()}`, (+c) - 1);
    }
}

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function(request, response) {
    response.sendFile(__dirname + '/views/index.html');
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
    console.log('Your app is listening on port ' + listener.address().port);
});

const get = async (song) => new Promise((resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/play`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }).on('response', async stream => {
      
        console.log(`Writing ${song.name} to tmpdisk...`);
      
        stream.pipe(fs.createWriteStream(`tmp/${song.name}.mp3`));

        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("finish", async () => {

            await upload({
                host: process.env.FTP_HOST,
                port: 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
            }, `tmp/${song.name}.mp3`, `${getDate()}/${song.name}.mp3`);

            resolve();
        });




    })
    //}).pipe(fs.createWriteStream(`${getDate()}/${file}.mp3`))
});

//dl('5d5bb9d09fa808020acde4d2');


//************ FTP custom (requires 'ftp')
const upload = async (credentials, pathToLocalFile, pathToRemoteFile) => new Promise((resolve, reject) => {
    var Client = require('ftp');
    var options = {
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {
        console.log(`[start]uploading ${pathToLocalFile} => ${pathToRemoteFile}`)
        c.put(pathToLocalFile, pathToRemoteFile, function(err) {
            c.end(); //end client
            fs.unlink(pathToLocalFile, (error) => {
                /* handle error */
            });
            console.log(`[done]uploaded ${pathToLocalFile} => ${pathToRemoteFile}`)
            if (err) reject(err); //reject promise
            resolve(); //fullfill promise
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

const deleteSong = (song => new Promise(async (resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/delete`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }, (error, response, result) => {

        if (error === null) {
            console.log(`${song.name} wurde gelöscht`);
            resolve();
        } else {
            console.error(error);
            return reject(error);
        }
        //create();
    });
}));
const create = () => new Promise(async (resolve, reject) => {
    if (quota.get() < 200)
        request({
            url: `https://${process.env.HOST}/composition/original/createFromPreset`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': process.env.TOKEN
            },
            json: {
                duration: "auto",
                ensemble: "auto",
                folderID: "",
                includeDrums: true,
                includeTempoMap: true,
                key: "auto",
                numberOfCompositions: "1",
                pacing: "auto",
                preset: "fantasy",
                timeSignature: "auto",
                token: process.env.TOKEN
            }
        }, (error, response, body) => {
            if (error === null) {
                const song = body.compositions[0];
                console.log(`#${song._id} (${song.name}) wird erstellt`);
                quota.add();
                resolve();
            } else {
                console.error(error);
                return reject(error);
            }
        });
    else console.log("Daily quota reached.")
});

const pumpSongs = () => {

    console.log("geting status...")

    request({
        url: `https://${process.env.HOST}/folder/getContent`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            folderID: "",
            getSharedContent: false,
            token: process.env.TOKEN
        }
    }, async (error, res, json) => {
        console.log("pumping songs")
        var i = 0;
        if (json.compositions.length > 0) {
            //Songs löschen
            for (var key in json.compositions) {
                const song = json.compositions[key];
                console.log(`deleting ${song.name}`)

                if (song.isFinished) { //done

                    await get(song);

                    await deleteSong(song);

                    i++;

                    if (i === json.compositions) {
                        console.log("all old songs have been uploaded.");
                        create();
                    }
                }
            }
        } else create(); //create new if not existing
    });
};

//create();
//clearAll()
setInterval(pumpSongs, 9999);