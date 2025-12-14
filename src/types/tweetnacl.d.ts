declare module 'tweetnacl' {
    export namespace box {
        export function keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
        export const nonceLength: number;
    }

    export function box(
        message: Uint8Array,
        nonce: Uint8Array,
        theirPublicKey: Uint8Array,
        mySecretKey: Uint8Array
    ): Uint8Array;

    namespace box {
        export function open(
            box: Uint8Array,
            nonce: Uint8Array,
            theirPublicKey: Uint8Array,
            mySecretKey: Uint8Array
        ): Uint8Array | null;
    }

    export function randomBytes(length: number): Uint8Array;
}

declare module 'tweetnacl-util' {
    export function encodeBase64(data: Uint8Array): string;
    export function decodeBase64(data: string): Uint8Array;
    export function encodeUTF8(data: Uint8Array): string;
    export function decodeUTF8(data: string): Uint8Array;
}
