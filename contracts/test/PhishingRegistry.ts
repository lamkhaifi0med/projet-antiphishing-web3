import { expect } from "chai";
import { ethers } from "hardhat";
import {
  PhishingRegistry,
  PhishingRegistry__factory,
} from "../typechain-types";

describe("PhishingRegistry", function () {
  const normalizedUrl = "blnance-support.xyz/claim";
  const urlHash = ethers.keccak256(ethers.toUtf8Bytes(normalizedUrl));
  const Category = {
    FakeExchange: 0,
    WalletDrainer: 1,
    FakeAirdrop: 2,
    FakeSupport: 3,
    Ponzi: 4,
    Other: 5,
  } as const;

  let registry: PhishingRegistry;
  let owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let reporter: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let outsider: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let maliciousWallet: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async function () {
    [owner, reporter, outsider, maliciousWallet] = await ethers.getSigners();
    registry = await new PhishingRegistry__factory(owner).deploy(owner.address);
    await registry.waitForDeployment();
    await registry.connect(owner).setReporter(reporter.address, true);
  });

  describe("reporter administration", function () {
    it("sets the deployer as owner and lets only the owner manage reporters", async function () {
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.reporters(reporter.address)).to.equal(true);

      await expect(
        registry.connect(outsider).setReporter(outsider.address, true),
      )
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });

    it("rejects the zero address as a reporter", async function () {
      await expect(
        registry.connect(owner).setReporter(ethers.ZeroAddress, true),
      )
        .to.be.revertedWithCustomError(registry, "InvalidReporter")
        .withArgs(ethers.ZeroAddress);
    });

    it("can revoke a reporter", async function () {
      await registry.connect(owner).setReporter(reporter.address, false);
      expect(await registry.reporters(reporter.address)).to.equal(false);

      await expect(
        registry.connect(reporter).reportURL(urlHash, Category.FakeAirdrop, 90),
      )
        .to.be.revertedWithCustomError(registry, "UnauthorizedReporter")
        .withArgs(reporter.address);
    });
  });

  describe("URL blacklist", function () {
    it("stores a URL report, emits an event, and exposes its metadata", async function () {
      await expect(
        registry.connect(reporter).reportURL(urlHash, Category.FakeAirdrop, 92),
      )
        .to.emit(registry, "URLReported")
        .withArgs(urlHash, Category.FakeAirdrop, 92, reporter.address);

      expect(await registry.isBlacklistedURL(urlHash)).to.equal(true);
      const entry = await registry.getURLEntry(urlHash);
      expect(entry.category).to.equal(Category.FakeAirdrop);
      expect(entry.score).to.equal(92);
      expect(entry.timestamp).to.be.greaterThan(0);
      expect(entry.reporter).to.equal(reporter.address);
      expect(entry.active).to.equal(true);
    });

    it("returns false and an inactive entry for an unknown URL", async function () {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("safe.example"));
      expect(await registry.isBlacklistedURL(unknownHash)).to.equal(false);
      expect((await registry.getURLEntry(unknownHash)).active).to.equal(false);
    });

    it("rejects reports from an address that is not an authorized reporter", async function () {
      await expect(
        registry.connect(outsider).reportURL(urlHash, Category.FakeAirdrop, 92),
      )
        .to.be.revertedWithCustomError(registry, "UnauthorizedReporter")
        .withArgs(outsider.address);
    });

    it("rejects duplicate active reports and scores above 100", async function () {
      await registry
        .connect(reporter)
        .reportURL(urlHash, Category.FakeAirdrop, 92);
      await expect(
        registry.connect(reporter).reportURL(urlHash, Category.FakeAirdrop, 92),
      )
        .to.be.revertedWithCustomError(registry, "EntryAlreadyActive")
        .withArgs(urlHash);

      const otherHash = ethers.keccak256(
        ethers.toUtf8Bytes("other-scam.example"),
      );
      await expect(
        registry.connect(reporter).reportURL(otherHash, Category.Other, 101),
      )
        .to.be.revertedWithCustomError(registry, "InvalidScore")
        .withArgs(101);
    });

    it("allows only the owner to deactivate a report and preserves its metadata", async function () {
      await registry
        .connect(reporter)
        .reportURL(urlHash, Category.FakeAirdrop, 92);

      await expect(registry.connect(outsider).removeURL(urlHash))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);

      await expect(registry.connect(owner).removeURL(urlHash))
        .to.emit(registry, "EntryRemoved")
        .withArgs(urlHash, false);

      const entry = await registry.getURLEntry(urlHash);
      expect(await registry.isBlacklistedURL(urlHash)).to.equal(false);
      expect(entry.score).to.equal(92);
      expect(entry.active).to.equal(false);
    });

    it("rejects removal of an inactive URL and allows a corrected re-report", async function () {
      await expect(registry.connect(owner).removeURL(urlHash))
        .to.be.revertedWithCustomError(registry, "EntryNotActive")
        .withArgs(urlHash);

      await registry
        .connect(reporter)
        .reportURL(urlHash, Category.FakeAirdrop, 92);
      await registry.connect(owner).removeURL(urlHash);
      await registry
        .connect(reporter)
        .reportURL(urlHash, Category.FakeSupport, 80);

      const entry = await registry.getURLEntry(urlHash);
      expect(entry.category).to.equal(Category.FakeSupport);
      expect(entry.score).to.equal(80);
      expect(entry.active).to.equal(true);
    });
  });

  describe("wallet blacklist", function () {
    it("stores and reads a wallet report", async function () {
      await expect(
        registry
          .connect(reporter)
          .reportWallet(maliciousWallet.address, Category.WalletDrainer, 98),
      )
        .to.emit(registry, "WalletReported")
        .withArgs(
          maliciousWallet.address,
          Category.WalletDrainer,
          98,
          reporter.address,
        );

      expect(
        await registry.isBlacklistedWallet(maliciousWallet.address),
      ).to.equal(true);
      const entry = await registry.getWalletEntry(maliciousWallet.address);
      expect(entry.category).to.equal(Category.WalletDrainer);
      expect(entry.score).to.equal(98);
      expect(entry.reporter).to.equal(reporter.address);
      expect(entry.active).to.equal(true);
    });

    it("rejects the zero wallet and scores above 100", async function () {
      await expect(
        registry
          .connect(reporter)
          .reportWallet(ethers.ZeroAddress, Category.Other, 50),
      )
        .to.be.revertedWithCustomError(registry, "InvalidWallet")
        .withArgs(ethers.ZeroAddress);

      await expect(
        registry
          .connect(reporter)
          .reportWallet(maliciousWallet.address, Category.Other, 101),
      )
        .to.be.revertedWithCustomError(registry, "InvalidScore")
        .withArgs(101);
    });

    it("rejects a duplicate active wallet and removal of an inactive wallet", async function () {
      const walletKey = ethers.zeroPadValue(maliciousWallet.address, 32);
      await registry
        .connect(reporter)
        .reportWallet(maliciousWallet.address, Category.WalletDrainer, 98);

      await expect(
        registry
          .connect(reporter)
          .reportWallet(maliciousWallet.address, Category.WalletDrainer, 98),
      )
        .to.be.revertedWithCustomError(registry, "EntryAlreadyActive")
        .withArgs(walletKey);

      await registry.connect(owner).removeWallet(maliciousWallet.address);
      await expect(
        registry.connect(owner).removeWallet(maliciousWallet.address),
      )
        .to.be.revertedWithCustomError(registry, "EntryNotActive")
        .withArgs(walletKey);
    });

    it("deactivates a wallet only for the owner", async function () {
      await registry
        .connect(reporter)
        .reportWallet(maliciousWallet.address, Category.WalletDrainer, 98);
      const walletKey = ethers.zeroPadValue(maliciousWallet.address, 32);

      await expect(
        registry.connect(owner).removeWallet(maliciousWallet.address),
      )
        .to.emit(registry, "EntryRemoved")
        .withArgs(walletKey, true);

      expect(
        await registry.isBlacklistedWallet(maliciousWallet.address),
      ).to.equal(false);
      expect(
        (await registry.getWalletEntry(maliciousWallet.address)).active,
      ).to.equal(false);
    });
  });
});
