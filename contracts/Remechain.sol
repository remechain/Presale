pragma solidity ^0.4.13;

// ERC20 token interface is implemented only partially
// (no SafeMath is used because contract code is very simple)
// 
// Some functions left undefined:
//  - transfer, transferFrom,
//  - approve, allowance.
contract PresaleToken
{
/// Fields:
    string public constant name = "Remechain Presale Token";
    string public constant symbol = "RMC";
    uint public constant decimals = 18;
    uint public constant PRICE = 320;  // per 1 Ether

    //  price
    // Cap is 1875 ETH
    // 1 RMC = 0,0031eth
    // ETH price ~290$ - 18.08.2017
    uint public constant TOKEN_SUPPLY_LIMIT = PRICE * 1562 * (1 ether / 1 wei);
    uint public constant SOFTCAP_LIMIT = PRICE * 667 * (1 ether / 1 wei);
    // 07.10.2017 0:00 MSK
    uint public icoDeadline = 1507323600;

    enum State{
       Init,
       Running,
       Paused,
       Migrating,
       Migrated
    }

    State public currentState = State.Init;
    uint public totalSupply = 0; // amount of tokens already sold

    // Gathered funds can be withdrawn only to escrow's address.
    address public escrow = 0;

    // Token manager has exclusive priveleges to call administrative
    // functions on this contract.
    address public tokenManager = 0;

    // Crowdsale manager has exclusive priveleges to burn presale tokens.
    address public crowdsaleManager = 0;

    mapping (address => uint256) public balances;
    mapping (address => uint256) public ethBalances;

struct Purchase {
      address buyer;
      uint amount;
    }
   Purchase[] purchases;
/// Modifiers:
    modifier onlyTokenManager()     { require(msg.sender == tokenManager); _;}
    modifier onlyCrowdsaleManager() { require(msg.sender == crowdsaleManager); _;}
    modifier onlyInState(State state){ require(state == currentState); _;}

/// Events:
    event LogBuy(address indexed owner, uint value);
    event LogBurn(address indexed owner, uint value);
    event LogStateSwitch(State newState);

/// Functions:
    /// @dev Constructor
    /// @param _tokenManager Token manager address.
    function PresaleToken(address _tokenManager, address _escrow) public
    {
        require(_tokenManager!=0);
        require(_escrow!=0);

        tokenManager = _tokenManager;
        escrow = _escrow;
    }
    
    function isIcoSuccessful() constant public returns(bool successful)  {
        return totalSupply >= SOFTCAP_LIMIT;
    }
    
    function isIcoOver() constant public returns(bool isOver) {
        return now >= icoDeadline;
    }

    function buyTokens(address _buyer) public payable onlyInState(State.Running)
    {
        assert(!isIcoOver());
        require(msg.value != 0);
        
        uint ethValue = msg.value;
        uint newTokens = msg.value * PRICE;
       
        require(!(totalSupply + newTokens < totalSupply));
    
        require(!(totalSupply + newTokens > TOKEN_SUPPLY_LIMIT));
        
        ethBalances[_buyer] += ethValue;
        balances[_buyer] += newTokens;
        totalSupply += newTokens;
        
        addAddressToList(_buyer);

        purchases[purchases.length++] = Purchase({buyer: _buyer, amount: newTokens});

        LogBuy(_buyer, newTokens);
    }
    
    address[] addressList;
    mapping (address => bool) isAddressInList;
    function addAddressToList(address _address) private {
        if (isAddressInList[_address]) {
            return;
        }
        addressList.push(_address);
        isAddressInList[_address] = true;
    }

    /// @dev Returns number of tokens owned by given address.
    /// @param _owner Address of token owner.
    function burnTokens(address _owner) public onlyCrowdsaleManager onlyInState(State.Migrating)
    {
        uint tokens = balances[_owner];
        require(tokens != 0);

        balances[_owner] = 0;
        totalSupply -= tokens;

        LogBurn(_owner, tokens);

        // Automatically switch phase when migration is done.
        if(totalSupply == 0) 
        {
            currentState = State.Migrated;
            LogStateSwitch(State.Migrated);
        }
    }

    /// @dev Returns number of tokens owned by given address.
    /// @param _owner Address of token owner.
    function balanceOf(address _owner) public constant returns (uint256) 
    {
        return balances[_owner];
    }

    function setPresaleState(State _nextState) public onlyTokenManager
    {
        // Init -> Running
        // Running -> Paused
        // Running -> Migrating
        // Paused -> Running
        // Paused -> Migrating
        // Migrating -> Migrated
        bool canSwitchState
             =  (currentState == State.Init && _nextState == State.Running)
             || (currentState == State.Running && _nextState == State.Paused)
             // switch to migration phase only if crowdsale manager is set
             || ((currentState == State.Running || currentState == State.Paused)
                 && _nextState == State.Migrating
                 && crowdsaleManager != 0x0)
             || (currentState == State.Paused && _nextState == State.Running)
             // switch to migrated only if everyting is migrated
             || (currentState == State.Migrating && _nextState == State.Migrated
                 && totalSupply == 0);

        require(canSwitchState);

        currentState = _nextState;
        LogStateSwitch(_nextState);
    }

    uint public nextInListToReturn = 0;
    uint private constant transfersPerIteration = 50;
    function returnToFunders() private {
        uint afterLast = nextInListToReturn + transfersPerIteration < addressList.length ? nextInListToReturn + transfersPerIteration : addressList.length; 
        
        for (uint i = nextInListToReturn; i < afterLast; i++) {
            address currentUser = addressList[i];
            if (ethBalances[currentUser] > 0) {
                currentUser.transfer(ethBalances[currentUser]);
                ethBalances[currentUser] = 0;
            }
        }
        
        nextInListToReturn = afterLast;
    }
    function withdrawEther() public
    {
        if (isIcoSuccessful()) {
            if(msg.sender == tokenManager && this.balance > 0) 
            {
                escrow.transfer(this.balance);
            }
        }
        else {
            if (isIcoOver()) {
                returnToFunders();
            }
        }
    }
    
    function returnFunds() public {
        returnFundsFor(msg.sender);
    }
    function returnFundsFor(address _user) public {
        assert(isIcoOver() && !isIcoSuccessful());
        assert(msg.sender == _user || msg.sender == tokenManager || msg.sender == address(this));
        
        if (ethBalances[_user] > 0) {
            _user.transfer(ethBalances[_user]);
            ethBalances[_user] = 0;
        }
    }

/// Setters/getters
    function setTokenManager(address _mgr) public onlyTokenManager
    {
        tokenManager = _mgr;
    }

    function setCrowdsaleManager(address _mgr) public onlyTokenManager
    {
        // You can't change crowdsale contract when migration is in progress.
        require(currentState != State.Migrating);

        crowdsaleManager = _mgr;
    }

    function getTokenManager() public constant returns(address)
    {
        return tokenManager;
    }

    function getCrowdsaleManager() public constant returns(address)
    {
        return crowdsaleManager;
    }

    function getCurrentState() public constant returns(State)
    {
        return currentState;
    }

    function getPrice() public constant returns(uint)
    {
        return PRICE;
    }

    function getTotalSupply() public constant returns(uint)
    {
        return totalSupply;
    }
    function getNumberOfPurchases() public constant returns(uint) {
        return purchases.length;
    }
    
    function getPurchaseAddress(uint index) public constant returns(address) {
        return purchases[index].buyer;
    }
    
    function getPurchaseAmount(uint index) public constant returns(uint) {
        return purchases[index].amount;
    }
    // Default fallback function
    function()  public payable 
    {
        buyTokens(msg.sender);
    }
}
