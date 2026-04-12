const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.verifyKey = functions.https.onCall(async (data, context) => {
  // Check if user is authenticated (they should be signed in anonymously first)
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The global function must be called while authenticated."
    );
  }

  const providedKey = data.key;

  if (!providedKey || typeof providedKey !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "The function must be called with one arguments 'key' containing the access key."
    );
  }

  try {
    // Check key against valid keys stored in Firestore
    const db = admin.firestore();
    const keyRef = db.collection("validKeys").doc(providedKey);
    const keyDoc = await keyRef.get();

    if (!keyDoc.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Invalid access key."
      );
    }

    // Set the custom claim.
    await admin.auth().setCustomUserClaims(context.auth.uid, { validUser: true });

    return { 
      message: "Success! Custom claim assigned.", 
      isValid: true 
    };

  } catch (error) {
    console.error("Error verifying key:", error);
    if (error.code === "permission-denied") {
      throw error; // Re-throw intentional HttpsError
    }
    throw new functions.https.HttpsError(
      "internal",
      "An internal server error occurred while verifying the access key."
    );
  }
});
