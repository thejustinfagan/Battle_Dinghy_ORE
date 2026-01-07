import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ExternalLink, Anchor, CheckCircle2, AlertCircle } from "lucide-react";
import { Connection, Transaction, PublicKey } from "@solana/web3.js";

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: () => Promise<{ publicKey: PublicKey }>;
      disconnect: () => Promise<void>;
      signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
      publicKey?: PublicKey;
      isConnected: boolean;
    };
  }
}

export default function JoinTestPage() {
  const [, params] = useRoute("/join-test/:gameId");
  const gameId = params?.gameId || "";
  const { toast } = useToast();

  const [twitterHandle, setTwitterHandle] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [blinkUrl, setBlinkUrl] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinComplete, setJoinComplete] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [txSignature, setTxSignature] = useState("");

  const { data: gameData, isLoading: gameLoading } = useQuery<{ game: Game }>({
    queryKey: [`/api/games/${gameId}`],
    enabled: !!gameId,
  });

  const game = gameData?.game;

  useEffect(() => {
    // Check if wallet is already connected
    if (window.solana?.isConnected && window.solana.publicKey) {
      setWalletConnected(true);
      setWalletAddress(window.solana.publicKey.toString());
    }
  }, []);

  const connectWallet = async () => {
    try {
      if (!window.solana) {
        toast({
          title: "Wallet not found",
          description: "Please install Phantom or another Solana wallet extension",
          variant: "destructive",
        });
        return;
      }

      const response = await window.solana.connect();
      setWalletConnected(true);
      setWalletAddress(response.publicKey.toString());
      toast({
        title: "Wallet connected",
        description: `Connected: ${response.publicKey.toString().slice(0, 8)}...`,
      });
    } catch (error) {
      console.error("Wallet connection error:", error);
      toast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : "Failed to connect wallet",
        variant: "destructive",
      });
    }
  };

  const verifyTwitter = async () => {
    setIsVerifying(true);
    try {
      const response = await fetch(`/api/games/${gameId}/verify-twitter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twitterHandle }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Verification failed");
      }

      setVerificationToken(data.token);
      setBlinkUrl(data.blinkUrl);
      toast({
        title: "Twitter verified",
        description: `Verified as @${data.twitterHandle}`,
      });
    } catch (error) {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const joinGame = async () => {
    if (!walletConnected || !walletAddress) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first",
        variant: "destructive",
      });
      return;
    }

    if (!verificationToken) {
      toast({
        title: "Not verified",
        description: "Please verify your Twitter handle first",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(true);
    try {
      // Step 1: Get transaction from backend
      const txResponse = await fetch(
        `/api/actions/game/${gameId}?token=${verificationToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: walletAddress }),
        }
      );

      const txData = await txResponse.json();

      if (!txResponse.ok) {
        throw new Error(txData.error?.message || "Failed to create transaction");
      }

      console.log("Transaction created:", txData);

      // Step 2: Deserialize transaction (browser-safe base64 decoding)
      const binaryString = atob(txData.transaction);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const transaction = Transaction.from(bytes);

      console.log("Transaction deserialized:", transaction);

      // Step 3: Sign and send via wallet (use transaction as-is from backend)
      if (!window.solana) {
        throw new Error("Wallet not available");
      }

      const { signature } = await window.solana.signAndSendTransaction(transaction);
      console.log("Transaction sent:", signature);

      setTxSignature(signature);

      // Step 4: Wait for confirmation
      toast({
        title: "Transaction sent",
        description: "Waiting for confirmation...",
      });

      const connection = new Connection(
        "https://devnet.helius-rpc.com/?api-key=17353c72-e996-42f9-afca-95974dfe93a8",
        "confirmed"
      );

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log("Transaction confirmed:", confirmation);

      // Step 6: Join game on backend
      const joinResponse = await fetch(`/api/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: verificationToken,
          walletAddress: walletAddress,
          txSignature: signature,
        }),
      });

      const joinData = await joinResponse.json();

      if (!joinResponse.ok) {
        throw new Error(joinData.error || "Failed to join game");
      }

      toast({
        title: "Success! 🎉",
        description: `Joined Battle Dinghy Game #${game?.gameNumber}!`,
      });
      
      // Mark join as complete
      setJoinComplete(true);
    } catch (error) {
      console.error("Join error:", error);
      toast({
        title: "Join failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsJoining(false);
    }
  };

  if (gameLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
              Game Not Found
            </CardTitle>
            <CardDescription>
              The game you're looking for doesn't exist or has been removed.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const network = import.meta.env.VITE_SOLANA_NETWORK || "devnet";
  const networkName = network === "devnet" ? "DEVNET" : "MAINNET";
  const networkEmoji = network === "devnet" ? "🧪" : "🚀";

  return (
    <div className="container mx-auto py-8 px-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Anchor className="h-6 w-6" />
            Join Battle Dinghy Game #{game.gameNumber}
          </CardTitle>
          <CardDescription>
            {networkEmoji} Testing on {networkName} - Direct Wallet Integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Game Info */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Entry Fee:</span>
              <span className="font-semibold">
                {(game.entryFeeSol / 1_000_000_000).toFixed(4)} SOL
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Players:</span>
              <span className="font-semibold">
                {game.currentPlayers} / {game.maxPlayers}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Prize Pool:</span>
              <span className="font-semibold">
                {(game.prizePoolSol / 1_000_000_000).toFixed(2)} SOL
              </span>
            </div>
          </div>

          {/* Step 1: Connect Wallet */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              {walletConnected ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-muted-foreground text-xs">
                  1
                </span>
              )}
              Connect Wallet
            </Label>
            {walletConnected ? (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <p className="text-sm text-green-900 dark:text-green-100">
                  Connected: {walletAddress.slice(0, 8)}...{walletAddress.slice(-8)}
                </p>
              </div>
            ) : (
              <Button
                onClick={connectWallet}
                className="w-full"
                data-testid="button-connect-wallet"
              >
                Connect Solana Wallet
              </Button>
            )}
          </div>

          {/* Step 2: Verify Twitter */}
          <div className="space-y-2">
            <Label htmlFor="twitter" className="flex items-center gap-2">
              {verificationToken ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-muted-foreground text-xs">
                  2
                </span>
              )}
              Twitter Handle
            </Label>
            {verificationToken ? (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <p className="text-sm text-green-900 dark:text-green-100">
                  Verified as @{twitterHandle.replace('@', '')}
                </p>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="twitter"
                  placeholder="yourhandle"
                  value={twitterHandle}
                  onChange={(e) => {
                    let value = e.target.value;
                    // Auto-add @ if not present
                    if (value && !value.startsWith('@')) {
                      value = '@' + value;
                    }
                    setTwitterHandle(value);
                  }}
                  data-testid="input-twitter"
                />
                <Button
                  onClick={verifyTwitter}
                  disabled={!twitterHandle || isVerifying}
                  data-testid="button-verify"
                >
                  {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
              </div>
            )}
          </div>

          {/* Step 3: Join Game */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              {joinComplete ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-muted-foreground text-xs">
                  3
                </span>
              )}
              Join Game
            </Label>
            {joinComplete ? (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                  ✅ Successfully joined the game!
                </p>
              </div>
            ) : (
              <Button
                onClick={joinGame}
                disabled={!walletConnected || !verificationToken || isJoining}
                className="w-full"
                size="lg"
                data-testid="button-join"
              >
                {isJoining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isJoining ? "Joining..." : "Join & Pay Entry Fee"}
              </Button>
            )}
          </div>

          {/* Transaction Success */}
          {txSignature && (
            <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg space-y-2">
              <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                Transaction confirmed! 🎉
              </p>
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=${network}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 hover:underline"
              >
                View on Solana Explorer
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Debug Info */}
          {import.meta.env.DEV && blinkUrl && (
            <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
              <p className="font-semibold">Debug Info:</p>
              <p className="break-all text-muted-foreground">Token: {verificationToken}</p>
              <p className="break-all text-muted-foreground">Blink: {blinkUrl}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
