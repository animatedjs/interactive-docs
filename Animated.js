/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule Animated
 */
'use strict';

var Animated = (function() {

// Note(vjeux): this would be better as an interface but flow doesn't
// support them yet
class Animated {
  attach(): void {}
  detach(): void {}
  getValue(): any {}
  getAnimatedValue(): any { return this.getValue(); }
  addChild(child: Animated) {}
  removeChild(child: Animated) {}
  getChildren(): Array<Animated> { return []; }
}

// Important note: start() and stop() will only be called at most once.
// Once an animation has been stopped or finished its course, it will
// not be reused.
class Animation {
  start(
    fromValue: number,
    onUpdate: (value: number) => void,
    onEnd: ?((finished: bool) => void),
    previousAnimation: ?Animation
  ): void {}
  stop(): void {}
}

class AnimatedWithChildren extends Animated {
  _children: Array<Animated>;

  constructor() {
    super();
    this._children = [];
  }

  addChild(child: Animated): void {
    if (this._children.length === 0) {
      this.attach();
    }
    this._children.push(child);
  }

  removeChild(child: Animated): void {
    var index = this._children.indexOf(child);
    if (index === -1) {
      console.warn('Trying to remove a child that doesn\'t exist');
      return;
    }
    this._children.splice(index, 1);
    if (this._children.length === 0) {
      this.detach();
    }
  }

  getChildren(): Array<Animated> {
    return this._children;
  }
}

/**
 * Animated works by building a directed acyclic graph of dependencies
 * transparently when you render your Animated components.
 *
 *               new Animated.Value(0)
 *     .interpolate()        .interpolate()    new Animated.Value(1)
 *         opacity               translateY      scale
 *          style                         transform
 *         View#234                         style
 *                                         View#123
 *
 * A) Top Down phase
 * When an Animated.Value is updated, we recursively go down through this
 * graph in order to find leaf nodes: the views that we flag as needing
 * an update.
 *
 * B) Bottom Up phase
 * When a view is flagged as needing an update, we recursively go back up
 * in order to build the new value that it needs. The reason why we need
 * this two-phases process is to deal with composite props such as
 * transform which can receive values from multiple parents.
 */
function _flush(node: AnimatedValue): void {
  var animatedStyles = new Set();
  function findAnimatedStyles(theNode) {
    if ('update' in theNode) {
      animatedStyles.add(theNode);
    } else {
      theNode.getChildren().forEach(findAnimatedStyles);
    }
  }
  findAnimatedStyles(node);
  animatedStyles.forEach(animatedStyle => animatedStyle.update());
}

type TimingAnimationConfig = {
  toValue: number;
  easing?: (value: number) => number;
  duration?: number;
  delay?: number;
};

class TimingAnimation extends Animation {
  _startTime: number;
  _fromValue: number;
  _toValue: number;
  _duration: number;
  _delay: number;
  _easing: (value: number) => number;
  _onUpdate: (value: number) => void;
  _onEnd: ?((finished: bool) => void);
  _animationFrame: any;
  _timeout: any;

  constructor(
    config: TimingAnimationConfig
  ) {
    super();
    this._toValue = config.toValue;
    this._easing = config.easing || Easing.inOut(Easing.ease);
    this._duration = config.duration !== undefined ? config.duration : 500;
    this._delay = config.delay || 0;
  }

  start(
    fromValue: number,
    onUpdate: (value: number) => void,
    onEnd: ?((finished: bool) => void)
  ): void {
    this._fromValue = fromValue;
    this._onUpdate = onUpdate;
    this._onEnd = onEnd;

    var start = () => {
      this._startTime = Date.now();
      this._animationFrame = window.requestAnimationFrame(this.onUpdate.bind(this));
    };
    if (this._delay) {
      this._timeout = setTimeout(start, this._delay);
    } else {
      start();
    }
  }

  onUpdate(): void {
    var now = Date.now();

    if (now > this._startTime + this._duration) {
      this._onUpdate(
        this._fromValue + this._easing(1) * (this._toValue - this._fromValue)
      );
      var onEnd = this._onEnd;
      this._onEnd = null;
      onEnd && onEnd(/* finished */ true);
      return;
    }

    this._onUpdate(
      this._fromValue +
        this._easing((now - this._startTime) / this._duration) *
        (this._toValue - this._fromValue)
    );

    this._animationFrame = window.requestAnimationFrame(this.onUpdate.bind(this));
  }

  stop(): void {
    clearTimeout(this._timeout);
    window.cancelAnimationFrame(this._animationFrame);
    var onEnd = this._onEnd;
    this._onEnd = null;
    onEnd && onEnd(/* finished */ false);
  }
}

type DecayAnimationConfig = {
  velocity: number;
  deceleration?: number;
};

class DecayAnimation extends Animation {
  _startTime: number;
  _lastValue: number;
  _fromValue: number;
  _deceleration: number;
  _velocity: number;
  _onUpdate: (value: number) => void;
  _onEnd: ?((finished: bool) => void);
  _animationFrame: any;

  constructor(
    config: DecayAnimationConfig
  ) {
    super();
    this._deceleration = config.deceleration || 0.998;
    this._velocity = config.velocity;
  }

  start(
    fromValue: number,
    onUpdate: (value: number) => void,
    onEnd: ?((finished: bool) => void)
  ): void {
    this._lastValue = fromValue;
    this._fromValue = fromValue;
    this._onUpdate = onUpdate;
    this._onEnd = onEnd;
    this._startTime = Date.now();
    this._animationFrame = window.requestAnimationFrame(this.onUpdate.bind(this));
  }

  onUpdate(): void {
    var now = Date.now();

    var value = this._fromValue +
      (this._velocity / (1 - this._deceleration)) *
      (1 - Math.exp(-(1 - this._deceleration) * (now - this._startTime)));

    this._onUpdate(value);

    if (Math.abs(this._lastValue - value) < 0.1) {
      var onEnd = this._onEnd;
      this._onEnd = null;
      onEnd && onEnd(/* finished */ true);
      return;
    }

    this._lastValue = value;
    this._animationFrame = window.requestAnimationFrame(this.onUpdate.bind(this));
  }

  stop(): void {
    window.cancelAnimationFrame(this._animationFrame);
    var onEnd = this._onEnd;
    this._onEnd = null;
    onEnd && onEnd(/* finished */ false);
  }
}

type SpringAnimationConfig = {
  toValue: number;
  overshootClamping?: bool;
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
  velocity?: number;
  bounciness?: number;
  speed?: number;
  tension?: number;
  friction?: number;
};

function withDefault<T>(value: ?T, defaultValue: T): T {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return value;
}


function tensionFromOrigamiValue(oValue) {
  return (oValue - 30.0) * 3.62 + 194.0;
}
function frictionFromOrigamiValue(oValue) {
  return (oValue - 8.0) * 3.0 + 25.0;
}

var fromOrigamiTensionAndFriction = function(tension, friction) {
  return {
    tension: tensionFromOrigamiValue(tension),
    friction: frictionFromOrigamiValue(friction)
  };
}

var fromBouncinessAndSpeed = function(bounciness, speed) {
  function normalize(value, startValue, endValue) {
    return (value - startValue) / (endValue - startValue);
  }
  function projectNormal(n, start, end) {
    return start + (n * (end - start));
  }
  function linearInterpolation(t, start, end) {
    return t * end + (1.0 - t) * start;
  }
  function quadraticOutInterpolation(t, start, end) {
    return linearInterpolation(2 * t - t * t, start, end);
  }
  function b3Friction1(x) {
    return (0.0007 * Math.pow(x, 3)) -
      (0.031 * Math.pow(x, 2)) + 0.64 * x + 1.28;
  }
  function b3Friction2(x) {
    return (0.000044 * Math.pow(x, 3)) -
      (0.006 * Math.pow(x, 2)) + 0.36 * x + 2.;
  }
  function b3Friction3(x) {
    return (0.00000045 * Math.pow(x, 3)) -
      (0.000332 * Math.pow(x, 2)) + 0.1078 * x + 5.84;
  }
  function b3Nobounce(tension) {
    if (tension <= 18) {
      return b3Friction1(tension);
    } else if (tension > 18 && tension <= 44) {
      return b3Friction2(tension);
    } else {
      return b3Friction3(tension);
    }
  }

  var b = normalize(bounciness / 1.7, 0, 20.0);
  b = projectNormal(b, 0.0, 0.8);
  var s = normalize(speed / 1.7, 0, 20.0);
  var bouncyTension = projectNormal(s, 0.5, 200)
  var bouncyFriction = quadraticOutInterpolation(
    b,
    b3Nobounce(bouncyTension),
    0.01
  );

  return {
    tension: tensionFromOrigamiValue(bouncyTension),
    friction: frictionFromOrigamiValue(bouncyFriction)
  };
}

class SpringAnimation extends Animation {
  _overshootClamping: bool;
  _restDisplacementThreshold: number;
  _restSpeedThreshold: number;
  _lastVelocity: number;
  _tempVelocity: number;
  _startPosition: number;
  _lastPosition: number;
  _tempPosition: number;
  _fromValue: number;
  _toValue: number;
  _tension: number;
  _friction: number;
  _lastTime: number;
  _onUpdate: (value: number) => void;
  _onEnd: ?((finished: bool) => void);
  _animationFrame: any;
  _active: bool;

  constructor(
    config: SpringAnimationConfig
  ) {
    super();

    this._overshootClamping = withDefault(config.overshootClamping, false);
    this._restDisplacementThreshold = withDefault(config.restDisplacementThreshold, 0.001);
    this._restSpeedThreshold = withDefault(config.restSpeedThreshold, 0.001);
    this._lastVelocity = withDefault(config.velocity, 0);
    this._tempVelocity = this._lastVelocity;
    this._toValue = config.toValue;

    var springConfig;
    if (config.bounciness !== undefined || config.speed !== undefined) {
      invariant(
        config.tension === undefined && config.friction === undefined,
        'You can only define bounciness/speed or tension/friction but not both'
      );
      springConfig = fromBouncinessAndSpeed(
        withDefault(config.bounciness, 8),
        withDefault(config.speed, 12)
      );
    } else {
      springConfig = fromOrigamiTensionAndFriction(
        withDefault(config.tension, 40),
        withDefault(config.friction, 7)
      );
    }
    this._tension = springConfig.tension;
    this._friction = springConfig.friction;
  }

  start(
    fromValue: number,
    onUpdate: (value: number) => void,
    onEnd: ?((finished: bool) => void),
    previousAnimation: ?Animation
  ): void {
    this._active = true;
    this._startPosition = fromValue;
    this._lastPosition = this._startPosition;
    this._tempPosition = this._lastPosition;

    this._onUpdate = onUpdate;
    this._onEnd = onEnd;
    this._lastTime = Date.now();

    if (previousAnimation instanceof SpringAnimation) {
      var internalState = previousAnimation.getInternalState();
      this._lastPosition = internalState.lastPosition;
      this._tempPosition = internalState.tempPosition;
      this._lastVelocity = internalState.lastVelocity;
      this._tempVelocity = internalState.tempVelocity;
      this._lastTime = internalState.lastTime;
    }

    this.onUpdate();
  }

  getInternalState(): any {
    return {
      lastPosition: this._lastPosition,
      tempPosition: this._tempPosition,
      lastVelocity: this._lastVelocity,
      tempVelocity: this._tempVelocity,
      lastTime: this._lastTime,
    };
  }

  onUpdate(): void {
    if (!this._active) {
      return;
    }
    var now = Date.now();

    var position = this._lastPosition;
    var velocity = this._lastVelocity;

    var tempPosition = position;
    var tempVelocity = velocity;

    var TIMESTEP_MSEC = 4;
    var numSteps = Math.floor((now - this._lastTime) / TIMESTEP_MSEC);
    for (var i = 0; i < numSteps; ++i) {
      // Velocity is based on seconds instead of milliseconds
      var step = TIMESTEP_MSEC / 1000;

      var aVelocity = velocity;
      var aAcceleration = this._tension * (this._toValue - tempPosition) - this._friction * tempVelocity;
      tempPosition = position + aVelocity * step / 2;
      tempVelocity = velocity + aAcceleration * step / 2;

      var bVelocity = tempVelocity;
      var bAcceleration = this._tension * (this._toValue - tempPosition) - this._friction * tempVelocity;
      tempPosition = position + bVelocity * step / 2;
      tempVelocity = velocity + bAcceleration * step / 2;

      var cVelocity = tempVelocity;
      var cAcceleration = this._tension * (this._toValue - tempPosition) - this._friction * tempVelocity;
      tempPosition = position + cVelocity * step;
      tempVelocity = velocity + cAcceleration * step;

      var dVelocity = tempVelocity;
      var dAcceleration = this._tension * (this._toValue - tempPosition) - this._friction * tempVelocity;

      var dxdt = (aVelocity + 2 * (bVelocity + cVelocity) + dVelocity) / 6;
      var dvdt = (aAcceleration + 2 * (bAcceleration + cAcceleration) + dAcceleration) / 6;

      position += dxdt * step;
      velocity += dvdt * step;
    }

    this._lastTime = now;
    this._tempPosition = tempPosition;
    this._tempVelocity = tempVelocity;
    this._lastPosition = position;
    this._lastVelocity = velocity;

    this._onUpdate(position);

    // Conditions for stopping the spring animation
    var isOvershooting = false;
    if (this._overshootClamping && this._tension !== 0) {
      if (this._startPosition < this._toValue) {
        isOvershooting = position > this._toValue;
      } else {
        isOvershooting = position < this._toValue;
      }
    }
    var isVelocity = Math.abs(velocity) <= this._restSpeedThreshold;
    var isDisplacement = true;
    if (this._tension !== 0) {
      isDisplacement = Math.abs(this._toValue - position) <= this._restDisplacementThreshold;
    }
    if (isOvershooting || (isVelocity && isDisplacement)) {
      var onEnd = this._onEnd;
      this._onEnd = null;
      onEnd && onEnd(/* finished */ true);
      return;
    }
    this._animationFrame = window.requestAnimationFrame(this.onUpdate.bind(this));
  }

  stop(): void {
    this._active = false;
    window.cancelAnimationFrame(this._animationFrame);
    var onEnd = this._onEnd;
    this._onEnd = null;
    onEnd && onEnd(/* finished */ false);
  }
}

type ValueListenerCallback = (state: {value: number}) => void;

var _uniqueId = 1;

class AnimatedValue extends AnimatedWithChildren {
  _value: number;
  _offset: number;
  _animation: ?Animation;
  _listeners: {[key: number]: ValueListenerCallback};

  constructor(value: number) {
    super();
    this._value = value;
    this._offset = 0;
    this._animation = null;
    this._listeners = {};
  }

  detach() {
    this.stopAnimation();
  }

  getValue(): number {
    return this._value + this._offset;
  }

  setValue(value: number): void {
    if (this._animation) {
      this._animation.stop();
      this._animation = null;
    }
    this._updateValue(value);
  }

  getOffset(): number {
    return this._offset;
  }

  setOffset(offset: number): void {
    this._offset = offset;
  }

  addListener(callback: ValueListenerCallback): number {
    var id = _uniqueId++;
    this._listeners[id] = callback;
    return id;
  }

  removeListener(id: number): void {
    delete this._listeners[id];
  }

  animate(animation: Animation, callback: ?((finished: bool) => void)): void {
    var previousAnimation = this._animation;
    this._animation && this._animation.stop();
    this._animation = animation;
    animation.start(
      this._value,
      (value) => {
        this._updateValue(value);
      },
      (finished) => {
        this._animation = null;
        callback && callback(finished);
      },
      previousAnimation
    );
  }

  stopAnimation(callback?: ?() => number): void {
    this.stopTracking();
    this._animation && this._animation.stop();
    callback && callback(this._value);
  }

  stopTracking(): void {
    this._tracking && this._tracking.detach();
  }

  track(tracking: Animation): void {
    this.stopTracking();
    this._tracking = tracking;
  }

  interpolate(config: InterpolationConfigType): AnimatedInterpolation {
    return new AnimatedInterpolation(this, Interpolation.create(config));
  }

  _updateValue(value: number): void {
    if (value === this._value) {
      return;
    }
    this._value = value;
    _flush(this);
    for (var key in this._listeners) {
      this._listeners[key]({value: this.getValue()});
    }
  }
}

type Vec2ListenerCallback = (state: {x: number; y: number}) => void;
class AnimatedVec2 extends AnimatedWithChildren {
  x: AnimatedValue;
  y: AnimatedValue;
  _listeners: {[key: number]: Vec2ListenerCallback};

  constructor(value?: {x: number; y: number}) {
    super();
    value = value || {x: 0, y: 0};
    if (typeof value.x === 'number') {
      this.x = new AnimatedValue(value.x);
      this.y = new AnimatedValue(value.y);
    } else {
      this.x = value.x;
      this.y = value.y;
    }
    this._listeners = {};
  }

  setValue(value: {x: number; y: number}) {
    this.x.setValue(value.x);
    this.y.setValue(value.y);
  }

  setOffset(offset: {x: number; y: number}) {
    this.x.setOffset(offset.x);
    this.y.setOffset(offset.y);
  }

  addListener(callback: Vec2ListenerCallback): number {
    var id = _uniqueId++;
    var jointCallback = (value) => {
      callback({x: this.x.getValue(), y: this.y.getValue()});
    };
    this._listeners[id] = {
      x: this.x.addListener(jointCallback),
      y: this.y.addListener(jointCallback),
    };
    return id;
  }

  removeListener(id: number): void {
    this.x.removeListener(this._listeners[id].x);
    this.y.removeListener(this._listeners[id].y);
    delete this._listeners[id];
  }

  offset(theOffset) { // chunky...perf?
    return new AnimatedVec2({
      x: this.x.interpolate({
        inputRange: [0, 1],
        outputRange: [theOffset.x, theOffset.x + 1],
      }),
      y: this.y.interpolate({
        inputRange: [0, 1],
        outputRange: [theOffset.y, theOffset.y + 1],
      }),
    });
  }

  getLayout() {
    return {
      left: this.x,
      top: this.y,
    };
  }

  getTranslateTransform() {
    return [
      {translateX: this.x},
      {translateY: this.y}
    ];
  }
}

class AnimatedInterpolation extends AnimatedWithChildren {
  _parent: Animated;
  _interpolation: (input: number) => number | string;
  _listeners: {[key: number]: ValueListenerCallback};
  _parentListener: number;

  constructor(parent: Animated, interpolation: (input: number) => number | string) {
    super();
    this._parent = parent;
    this._interpolation = interpolation;
    this._listeners = {};
  }

  getValue(): number | string {
    var parentValue: number = this._parent.getValue();
    invariant(
      typeof parentValue === 'number',
      'Cannot interpolate an input which is not a number.'
    );
    return this._interpolation(parentValue);
  }

  addListener(callback: ValueListenerCallback): number {
    if (!this._parentListener) {
      this._parentListener = parent.addListener(() => {
        for (var key in this._listeners) {
          this._listeners[key]({value: this.getValue()});
        }
      })
    }
    var id = _uniqueId++;
    this._listeners[id] = callback;
    return id;
  }

  removeListener(id: number): void {
    delete this._listeners[id];
  }

  interpolate(config: InterpolationConfigType): AnimatedInterpolation {
    return new AnimatedInterpolation(this, Interpolation.create(config));
  }

  attach(): void {
    this._parent.addChild(this);
  }

  detach(): void {
    this._parent.removeChild(this);
    this._parentListener = this._parent.removeListener(this._parentListener);
  }
}

class AnimatedTransform extends AnimatedWithChildren {
  _transforms: Array<Object>;

  constructor(transforms: Array<Object>) {
    super();
    this._transforms = transforms;
  }

  getValue(): Array<Object> {
    return this._transforms.map(transform => {
      var result = '';
      for (var key in transform) {
        var value = transform[key];
        if (value instanceof Animated) {
          result += key + '(' + value.getValue() + ')';
        } else {
          result += key + '(' + value.join(',') + ')';
        }
      }
      return result;
    }).join(' ');
  }

  getAnimatedValue(): Array<Object> {
    return this._transforms.map(transform => {
      var result = '';
      for (var key in transform) {
        var value = transform[key];
        if (value instanceof Animated) {
          result += key + '(' + value.getValue() + ') ';
        } else {
          // All transform components needed to recompose matrix
          result += key + '(' + value.join(',') + ') ';
        }
      }
      return result;
    }).join('').trim();
  }

  attach(): void {
    this._transforms.forEach(transform => {
      for (var key in transform) {
        var value = transform[key];
        if (value instanceof Animated) {
          value.addChild(this);
        }
      }
    });
  }

  detach(): void {
    this._transforms.forEach(transform => {
      for (var key in transform) {
        var value = transform[key];
        if (value instanceof Animated) {
          value.removeChild(this);
        }
      }
    });
  }
}

class AnimatedStyle extends AnimatedWithChildren {
  _style: Object;

  constructor(style: any) {
    super();
    style = style || {};
    if (style.transform) {
      style = {
        ...style,
        transform: new AnimatedTransform(style.transform),
      };
    }
    this._style = style;
  }

  getValue(): Object {
    var style = {};
    for (var key in this._style) {
      var value = this._style[key];
      if (value instanceof Animated) {
        style[key] = value.getValue();
      } else {
        style[key] = value;
      }
    }
    return style;
  }

  getAnimatedValue(): Object {
    var style = {};
    for (var key in this._style) {
      var value = this._style[key];
      if (value instanceof Animated) {
        style[key] = value.getAnimatedValue();
      }
    }
    return style;
  }

  attach(): void {
    for (var key in this._style) {
      var value = this._style[key];
      if (value instanceof Animated) {
        value.addChild(this);
      }
    }
  }

  detach(): void {
    for (var key in this._style) {
      var value = this._style[key];
      if (value instanceof Animated) {
        value.removeChild(this);
      }
    }
  }
}

class AnimatedProps extends Animated {
  _props: Object;
  _callback: () => void;

  constructor(
    props: Object,
    callback: () => void
  ) {
    super();
    if (props.style) {
      props = {
        ...props,
        style: new AnimatedStyle(props.style),
      };
    }
    this._props = props;
    this._callback = callback;
    this.attach();
  }

  getValue(): Object {
    var props = {};
    for (var key in this._props) {
      var value = this._props[key];
      if (value instanceof Animated) {
        props[key] = value.getValue();
      } else {
        props[key] = value;
      }
    }
    return props;
  }

  getAnimatedValue(): Object {
    var props = {};
    for (var key in this._props) {
      var value = this._props[key];
      if (value instanceof Animated) {
        props[key] = value.getAnimatedValue();
      }
    }
    return props;
  }

  attach(): void {
    for (var key in this._props) {
      var value = this._props[key];
      if (value instanceof Animated) {
        value.addChild(this);
      }
    }
  }

  detach(): void {
    for (var key in this._props) {
      var value = this._props[key];
      if (value instanceof Animated) {
        value.removeChild(this);
      }
    }
  }

  update(): void {
    this._callback();
  }
}

function createAnimatedComponent(Component: any): any {
  var refName = 'node';

  class AnimatedComponent extends React.Component {
    _propsAnimated: AnimatedProps;

    componentWillUnmount() {
      this._propsAnimated && this._propsAnimated.detach();
    }

    setNativeProps(props) {
      this.refs[refName].setNativeProps(props);
    }

    componentWillMount() {
      this.attachProps(this.props);
    }

    attachProps(nextProps) {
      var oldPropsAnimated = this._propsAnimated;

      // The system is best designed when setNativeProps is implemented. It is
      // able to avoid re-rendering and directly set the attributes that
      // changed. However, setNativeProps can only be implemented on leaf
      // native components. If you want to animate a composite component, you
      // need to re-render it. In this case, we have a fallback that uses
      // forceUpdate.
      var callback = () => {
        if (this.refs[refName].setNativeProps) {
          var value = this._propsAnimated.getAnimatedValue();
          this.refs[refName].setNativeProps(value);
        } else if (this.refs[refName].getDOMNode().setAttribute) {
          var value = this._propsAnimated.getAnimatedValue();
          var strStyle = React.CSSPropertyOperations.setValueForStyles(this.refs[refName].getDOMNode(), value.style, this.refs[refName]);
        } else {
          this.forceUpdate();
        }
      };

      this._propsAnimated = new AnimatedProps(
        nextProps,
        callback
      );

      // When you call detach, it removes the element from the parent list
      // of children. If it goes to 0, then the parent also detaches itself
      // and so on.
      // An optimization is to attach the new elements and THEN detach the old
      // ones instead of detaching and THEN attaching.
      // This way the intermediate state isn't to go to 0 and trigger
      // this expensive recursive detaching to then re-attach everything on
      // the very next operation.
      oldPropsAnimated && oldPropsAnimated.detach();
    }

    componentWillReceiveProps(nextProps) {
      this.attachProps(nextProps);
    }

    render() {
      return (
        <Component
          {...this._propsAnimated.getValue()}
          ref={refName}
        />
      );
    }
  }

  return AnimatedComponent;
}

class AnimatedTracking extends Animated {
  _parent: Animated;
  _callback: () => void;

  constructor(
    value: AnimatedValue,
    parent: Animated,
    animationClass: any,
    animationConfig: any,
    callback: any
  ) {
    super();
    this._value = value;
    this._parent = parent;
    this._animationClass = animationClass;
    this._animationConfig = animationConfig;
    this._callback = callback;
    this.attach();
  }

  getValue(): Object {
    return this._parent.getValue();
  }

  attach(): void {
    this._active = true;
    this._parent.addChild(this);
  }

  detach(): void {
    this._parent.removeChild(this);
    this._active = false;
  }

  update(): void {
    if (!this._active) {
      console.warn('calling update on detached AnimatedTracking');
      return;
    }
    // console.log('AnimatedTracking update with ',
    //   {toValue: this._animationConfig.toValue.getValue(), value: this._value.getValue()});
    this._value.animate(new this._animationClass({
      ...this._animationConfig,
      toValue: (this._animationConfig.toValue: any).getValue(),
    }), this._callback);
  }
}

type CompositeAnimation = {
  start: (callback?: ?(finished: bool) => void) => void;
  stop: () => void;
};

var maybeVectorAnim = function(
  value: AnimatedValue,
  config: Object,
  anim: (value: AnimatedValue, config: Object) => CompositeAnimation
): CompositeAnimation {
  if (value instanceof AnimatedVec2) {
    var configX = {...config};
    var configY = {...config};
    for (var key in config) {
      var {x, y} = config[key];
      if (x !== undefined && y !== undefined) {
        configX[key] = x;
        configY[key] = y;
      }
    }
    // TODO: Urg, parallel breaks tracking :(
    // return parallel([
    //   anim(value.x, configX),
    //   anim(value.y, configY),
    // ]);
    anim(value.x, configX).start();
    return anim(value.y, configY);
  }
  return null;
};

var spring = function(
  value: AnimatedValue,
  config: SpringAnimationConfig
): CompositeAnimation {
  return maybeVectorAnim(value, config, spring) || {
    start: function(callback?: ?(finished: bool) => void): void {
      value.stopTracking();
      if (config.toValue instanceof Animated) {
        value.track(new AnimatedTracking(
          value,
          config.toValue,
          SpringAnimation,
          config,
          callback
        ));
      } else {
        value.animate(new SpringAnimation(config), callback);
      }
    },

    stop: function(): void {
      value.stopAnimation();
    },
  };
};

var timing = function(
  value: AnimatedValue,
  config: TimingAnimationConfig
): CompositeAnimation {
  return maybeVectorAnim(value, config, timing) || {
    start: function(callback?: ?(finished: bool) => void): void {
      value.stopTracking();
      value.animate(new TimingAnimation(config), callback);
    },

    stop: function(): void {
      value.stopAnimation();
    },
  };
};

var decay = function(
  value: AnimatedValue,
  config: DecayAnimationConfig
): CompositeAnimation {
  return maybeVectorAnim(value, config, decay) || {
    start: function(callback?: ?(finished: bool) => void): void {
      value.stopTracking();
      value.animate(new DecayAnimation(config), callback);
    },

    stop: function(): void {
      value.stopAnimation();
    },
  };
};

var sequence = function(
  animations: Array<CompositeAnimation>
): CompositeAnimation {
  var current = 0;
  return {
    start: function(callback?: ?(finished: bool) => void) {
      var onComplete = function(finished) {
        if (!finished) {
          callback && callback(finished);
          return;
        }

        current++;

        if (current === animations.length) {
          callback && callback(/* finished */ true);
          return;
        }

        animations[current].start(onComplete);
      };

      if (animations.length === 0) {
        callback && callback(/* finished */ true);
      } else {
        animations[current].start(onComplete);
      }
    },

    stop: function() {
      if (current < animations.length) {
        animations[current].stop();
      }
    }
  };
};

var parallel = function(
  animations: Array<CompositeAnimation>
): CompositeAnimation {
  var doneCount = 0;
  // Variable to make sure we only call stop() at most once
  var hasBeenStopped = false;

  var result = {
    start: function(callback?: ?(finished: bool) => void) {
      if (doneCount === animations.length) {
        callback && callback(/* finished */ true);
        return;
      }

      animations.forEach((animation, idx) => {
        animation.start(finished => {
          doneCount++;
          if (doneCount === animations.length) {
            callback && callback(finished);
            return;
          }

          if (!finished && !hasBeenStopped) {
            result.stop();
          }
        });
      });
    },

    stop: function(): void {
      hasBeenStopped = true;
      animations.forEach(animation => {
        animation.stop();
      });
    }
  };

  return result;
};

var delay = function(time: number): CompositeAnimation {
  // Would be nice to make a specialized implementation.
  return timing(new AnimatedValue(0), {toValue: 0, delay: time, duration: 0});
};

var stagger = function(
  time: number,
  animations: Array<CompositeAnimation>
): CompositeAnimation {
  return parallel(animations.map((animation, i) => {
    return sequence([
      delay(time * i),
      animation,
    ]);
  }));
};

type Mapping = {[key: string]: Mapping} | AnimatedValue;

/**
 *  Takes an array of mappings and extracts values from each arg accordingly,
 *  then calls setValue on the mapped outputs.  e.g.
 *
 *  onScroll={this.AnimatedEvent(
 *    [{nativeEvent: {contentOffset: {x: this._scrollX}}}]
 *    {listener, updatePeriod: 100}  // optional listener invoked every 100ms
 *  )
 *  ...
 *  onPanResponderMove: this.AnimatedEvent([
 *    null,                               // raw event arg
 *    {dx: this._panX},                   // gestureState arg
 *  ]),
 *
 */
var event = function(
  argMapping: Array<Mapping>,
  config?: any
): () => void {
  var lastUpdate = 0;
  var timer;
  var isEnabled = true;
  if (config && config.ref) {
    config.ref({
      enable: () => {
        isEnabled = true;
      },
      disable: () => {
        isEnabled = false;
        clearTimeout(timer);
        timer = null;
      },
    });
  }
  var lastArgs;
  return function(): void {
    lastArgs = arguments;
    if (!isEnabled) {
      clearTimeout(timer);
      timer = null;
      return;
    }
    var traverse = function(recMapping, recEvt, key) {
      if (recMapping instanceof AnimatedValue
          || recMapping instanceof AnimatedInterpolation) {
        invariant(
          typeof recEvt === 'number',
          'Bad event element of type ' + typeof recEvt + ' for key ' + key
        );
        recMapping.setValue(recEvt);
        return;
      }
      invariant(
        typeof recMapping === 'object',
        'Bad mapping of type ' + typeof recMapping + ' for key ' + key
      );
      invariant(
        typeof recEvt === 'object',
        'Bad event of type ' + typeof recEvt + ' for key ' + key
      );
      for (var key in recMapping) {
        traverse(recMapping[key], recEvt[key], key);
      }
    };
    argMapping.forEach((mapping, idx) => {
      traverse(mapping, lastArgs[idx], null);
    });
    if (config && config.listener && !timer) {
      var cb = () => {
        lastUpdate = Date.now();
        timer = null;
        config.listener.apply(null, lastArgs);
      };
      if (config.updatePeriod) {
        timer = setTimeout(cb, config.updatePeriod - Date.now() + lastUpdate);
      } else {
        cb();
      }
    }
  };
};

return module.exports = {
  delay,
  sequence,
  parallel,
  stagger,

  decay,
  timing,
  spring,

  event,

  Value: AnimatedValue,
  Vec2: AnimatedVec2,
  __PropsOnlyForTests: AnimatedProps,
  div: createAnimatedComponent('div'),
  createAnimatedComponent,
};

})();
