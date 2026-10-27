// Runs the QUnit suite (test/index.html) in headless Chrome and prints
// one line per test plus a summary; exits non-zero when any test fails.
// Usage: node test/headless/run.js <url>   (needs puppeteer-core on NODE_PATH)
"use strict";

const puppeteer = require( "puppeteer-core" );

const url = process.argv[ 2 ];
const executablePath = process.env.CHROME_BIN || "google-chrome-stable";
const overallTimeout = 30 * 60 * 1000;

( async function() {
	const browser = await puppeteer.launch( {
		executablePath,
		headless: "new",
		args: [ "--no-sandbox", "--disable-dev-shm-usage" ]
	} );
	const page = await browser.newPage();
	let tests = 0, testsPassed = 0, testsFailed = 0;
	let finish;
	const finished = new Promise( ( resolve ) => { finish = resolve; } );

	page.on( "pageerror", ( e ) => console.log( "[pageerror] " + e.message ) );
	page.on( "console", ( m ) => {
		if ( /^\[skip\]/.test( m.text() ) ) {
			console.log( "SKIP " + m.text().slice( 7 ) );
		} else if ( /^\[csp\]/.test( m.text() ) ) {
			console.log( m.text() );
		}
	} );

	await page.exposeFunction( "__qunitTestDone", ( d ) => {
		tests++;
		if ( d.failed ) {
			testsFailed++;
		} else {
			testsPassed++;
		}
		console.log( ( d.failed ? "FAIL " : "PASS " ) + d.module + " :: " + d.name +
			" (" + d.passed + "/" + d.total + " assertions)" );
		d.failures.forEach( ( f ) => console.log( "    " + f ) );
	} );
	await page.exposeFunction( "__qunitDone", ( d ) => finish( d ) );

	await page.evaluateOnNewDocument( () => {
		// Only the CSP fixture page sends a Content-Security-Policy; report what it blocks.
		if ( /\/csp\.php$/.test( location.pathname ) ) {
			document.addEventListener( "securitypolicyviolation", ( e ) => {
				console.log( "[csp] violation in " + location.pathname + ": " + e.violatedDirective +
					" blocked=" + e.blockedURI + " at " + e.sourceFile + ":" + e.lineNumber +
					" sample=" + e.sample );
			} );
		}
		if ( window !== window.top ) {
			return;
		}
		document.addEventListener( "DOMContentLoaded", () => {
			const QUnit = window.QUnit;
			let failures = [];
			QUnit.log( ( d ) => {
				if ( !d.result ) {
					failures.push( "assertion failed: " + ( d.message || "" ) +
						( "expected" in d ? " | expected: " + String( d.expected ) +
							" | actual: " + String( d.actual ) : "" ) +
						( d.source ? " | " + String( d.source ).split( "\n" )[ 0 ] : "" ) );
				}
			} );
			QUnit.testDone( ( d ) => {
				window.__qunitTestDone( {
					module: d.module, name: d.name, failed: d.failed,
					passed: d.passed, total: d.total, failures
				} );
				failures = [];
			} );
			QUnit.done( ( d ) => window.__qunitDone( d ) );
		} );
	} );

	console.log( "Loading " + url );
	await page.goto( url, { waitUntil: "load", timeout: 120000 } );

	const timer = setTimeout( () => finish( null ), overallTimeout );
	const result = await finished;
	clearTimeout( timer );
	await browser.close();

	if ( !result ) {
		console.log( "QUnit suite timed out after " + tests + " tests" );
		process.exit( 2 );
	}
	console.log( "" );
	console.log( "QUnit summary: " + tests + " tests, " + testsPassed + " passed, " +
		testsFailed + " failed; assertions: " + result.total + " total, " +
		result.passed + " passed, " + result.failed + " failed (" + result.runtime + " ms)" );
	process.exit( result.failed || testsFailed ? 1 : 0 );
} )().catch( ( e ) => {
	console.error( e );
	process.exit( 3 );
} );
